// T6 · 进度上云同步策略（issue #28 / spec #22「进度上云」）：
// - 合并进度：本地与云进度按字段并集合并，同键冲突云端为准（云端为准、同键覆盖）；
// - 创建进度节流器：判定后约 3 秒静默窗口，窗口内多次判定压一次云写（节流非防抖：
//   首个判定起算，窗口结束写最新值，不随后续判定顺延）；
// - 同步状态机：断网/失败积压 → 指数退避静默重试 → 恢复在线立即冲写的纯状态转移。
// 全部纯函数/可注入计时器，供单测穷举（不依赖真实云与真实时钟）。
// 进度记录 ProgressRecord 的 JSON 字段（passedIndices/hintsSeen 等）随 NT3 英文化（#37）。

import type { ProgressRecord } from "@/components/progress";

/** 并集（数字数组），结果升序去重 */
function union(local: number[], cloud: number[]): number[] {
  return [...new Set([...local, ...cloud])].sort((a, b) => a - b);
}

/**
 * 本地与云进度合并（云端为准、同键覆盖）：字段取并集保互不丢题；
 * 同键冲突取云端值；云端为空记录（无该会话数据）时原样保留本地，不作清空。
 */
export function mergeProgress(local: ProgressRecord, cloud: ProgressRecord): ProgressRecord {
  const hintsSeen: Record<string, number> = { ...local.hintsSeen, ...cloud.hintsSeen };
  const attempts: Record<string, number> = { ...local.attemptCounts, ...cloud.attemptCounts };
  // 空对象合并后仍可能残留本地独有条目——这正是并集语义，无需清理
  return {
    passedIndices: union(local.passedIndices, cloud.passedIndices),
    assistedAnswerIndices: union(local.assistedAnswerIndices, cloud.assistedAnswerIndices),
    hintsSeen: hintsSeen,
    attemptCounts: attempts,
    drafts: { ...local.drafts, ...cloud.drafts },
  };
}

/**
 * 判定后节流合并写（注入写入函数与窗口以便单测）：
 * schedule = 收到判定结果（或任何需上云的进度变更），窗口内多次只压一次写；
 * flush = 会话结束/页面卸载前把待写值立刻落一次并取消计时。
 */
export function createProgressThrottler(
  write: (progress: ProgressRecord) => void,
  throttleMs = 3000,
): { schedule: (progress: ProgressRecord) => void; flush: () => void } {
  let pending: ProgressRecord | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flushNow = () => {
    if (pending === null) return;
    const progress = pending;
    pending = null;
    write(progress);
  };
  return {
    schedule: (progress) => {
      pending = progress;
      if (timer === null) timer = setTimeout(() => { timer = null; flushNow(); }, throttleMs);
    },
    flush: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flushNow();
    },
  };
}

/** 同步阶段：空闲（无待写）/ 待写（节流窗口中）/ 写中（云写进行或待重试触发）/ 积压（写失败待重试） */
export type SyncState =
  | { phase: "idle"; retries: number }
  | { phase: "pending"; windowStart: number; retries: number }
  | { phase: "writing"; retries: number }
  | { phase: "backlog"; retries: number; nextRetryAt: number };

export type SyncEvent =
  | { type: "judgement"; at: number }
  | { type: "throttleElapsed"; at: number }
  | { type: "retryDue" }
  | { type: "writeSucceeded" }
  | { type: "writeFailed"; at: number }
  | { type: "backOnline"; at: number };

/** 状态机对调用方的副作用指令：安排 3 秒节流计时 / 按退避安排重试计时 */
export type SyncAction = "none" | "scheduleThrottledWrite" | "scheduleRetry";

export function initialSyncState(): SyncState {
  return { phase: "idle", retries: 0 };
}

/** 指数退避：3s → 6s → 12s … 封顶 15s（静默重试不弹 UI，e2e 可等待） */
export function retryBackoffMs(retries: number): number {
  return Math.min(3000 * 2 ** (retries - 1), 15_000);
}

/**
 * 同步状态机（纯转移函数）：判定写入只从 空闲 起窗（待写中不重开、积压中并入载荷）；
 * 节流到期/重试时刻到/恢复在线（积压时）转 写中；写成功清积压回空闲，写失败转积压并
 * 按指数退避安排重试。动作由调用方执行副作用（真实计时器与云写）。
 */
export function syncStateMachine(state: SyncState, event: SyncEvent): [SyncState, SyncAction] {
  switch (event.type) {
    case "judgement": {
      if (state.phase === "idle")
        return [{ phase: "pending", windowStart: event.at, retries: state.retries }, "scheduleThrottledWrite"];
      return [state, "none"];
    }
    case "throttleElapsed": {
      if (state.phase !== "pending") return [state, "none"];
      return [{ phase: "writing", retries: state.retries }, "none"];
    }
    case "retryDue": {
      if (state.phase !== "backlog") return [state, "none"];
      return [{ phase: "writing", retries: state.retries }, "none"];
    }
    case "backOnline": {
      if (state.phase !== "backlog") return [state, "none"];
      return [{ phase: "writing", retries: state.retries }, "none"];
    }
    case "writeSucceeded":
      return [{ phase: "idle", retries: 0 }, "none"];
    case "writeFailed": {
      // 写成功清零，故 写中 保留的 retries +1 即累计重试次数
      const retries = state.retries + 1;
      return [
        { phase: "backlog", retries, nextRetryAt: event.at + retryBackoffMs(retries) },
        "scheduleRetry",
      ];
    }
  }
}
