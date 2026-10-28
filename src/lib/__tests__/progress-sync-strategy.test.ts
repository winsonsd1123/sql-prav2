// T6 · 进度上云同步策略纯函数（issue #28）：本地与云进度合并规则、
// 判定后节流合并写、断网积压与恢复冲写的状态机。只测模块边界行为，不测实现细节。
// 进度记录字段（已通过题号 等）为既有中文数据结构，不在本票范围。
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  mergeProgress,
  createProgressThrottler,
  initialSyncState,
  syncStateMachine,
} from "@/lib/progress-sync-strategy";
import { 空进度, 记通过, 记尝试, 记草稿, type 进度记录 } from "@/components/进度";

const localOne = {
  ...空进度,
  已通过题号: [1],
  尝试次数: { "1": 2 },
  草稿: { "1": "SELECT 本地" },
};

const cloudOne = {
  ...空进度,
  已通过题号: [3],
  已看提示: { "3": 1 },
  尝试次数: { "3": 4 },
  草稿: { "3": "SELECT 云端" },
};

describe("合并进度（云端为准、同键覆盖）", () => {
  it("两侧并集保留，互不丢题", () => {
    const merged = mergeProgress(localOne, cloudOne);
    expect(merged.已通过题号).toEqual([1, 3]);
    expect(merged.草稿["1"]).toBe("SELECT 本地");
    expect(merged.草稿["3"]).toBe("SELECT 云端");
  });

  it("同键冲突时云端覆盖本地", () => {
    const local = { ...localOne, 尝试次数: { "1": 5, "2": 1 }, 已看提示: { "2": 2 } };
    const cloud = { ...cloudOne, 尝试次数: { "1": 2, "2": 7 }, 已看提示: { "2": 1 } };
    const merged = mergeProgress(local, cloud);
    expect(merged.尝试次数["1"]).toBe(2);
    expect(merged.尝试次数["2"]).toBe(7);
    expect(merged.已看提示["2"]).toBe(1);
  });

  it("云端为空记录时保留本地（云端无该会话数据不作清空）", () => {
    const merged = mergeProgress(localOne, 空进度);
    expect(merged).toEqual(localOne);
  });

  it("已借助答案取并集（语义标记不可因合并丢失）", () => {
    const merged = mergeProgress(
      { ...空进度, 已借助答案题号: [0] },
      { ...空进度, 已借助答案题号: [2] },
    );
    expect(merged.已借助答案题号).toEqual([0, 2]);
  });

  it("不可变：不修改入参", () => {
    const localCopy = JSON.parse(JSON.stringify(localOne)) as 进度记录;
    const cloudCopy = JSON.parse(JSON.stringify(cloudOne)) as 进度记录;
    mergeProgress(localOne, cloudOne);
    expect(localOne).toEqual(localCopy);
    expect(cloudOne).toEqual(cloudCopy);
  });
});

describe("创建进度节流器（判定后约 3 秒静默合并写）", () => {
  afterEach(() => vi.useRealTimers());

  it("窗口内多次判定只压一次写，载荷为最新进度", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const throttler = createProgressThrottler(write, 3000);
    let p = 记尝试(空进度, 0);
    throttler.schedule(p);
    p = 记尝试(p, 0);
    throttler.schedule(p);
    p = 记通过(p, 0);
    throttler.schedule(p);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2999);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(p);
  });

  it("首个判定即起算窗口，后续判定不重置截止时刻（节流非防抖）", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const throttler = createProgressThrottler(write, 3000);
    throttler.schedule(记尝试(空进度, 0));
    vi.advanceTimersByTime(2000);
    throttler.schedule(记草稿(空进度, 1, "SELECT 二秒")); // 窗口后半段的新判定
    vi.advanceTimersByTime(1000); // 距首个判定 3 秒，应已写
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("窗口结束后的新判定开启新窗口", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const throttler = createProgressThrottler(write, 3000);
    throttler.schedule(记尝试(空进度, 0));
    vi.advanceTimersByTime(3000);
    throttler.schedule(记尝试(空进度, 1));
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("立即冲写：窗口未到也立刻落一次最新值，且不再重复写", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const throttler = createProgressThrottler(write, 3000);
    const p = 记通过(空进度, 2);
    throttler.schedule(p);
    throttler.flush();
    expect(write).toHaveBeenCalledWith(p);
    vi.advanceTimersByTime(3000);
    expect(write).toHaveBeenCalledTimes(1); // 冲写后计时器取消
  });

  it("无待写时立即冲写不产生写入", () => {
    const write = vi.fn();
    createProgressThrottler(write, 3000).flush();
    expect(write).not.toHaveBeenCalled();
  });
});

describe("同步状态机（断网积压 → 恢复冲写）", () => {
  it("判定写入从空闲进入待写并给出安排节流动作", () => {
    const [state, action] = syncStateMachine(initialSyncState(), { type: "judgement", at: 1000 });
    expect(state).toEqual({ phase: "pending", windowStart: 1000, retries: 0 });
    expect(action).toBe("scheduleThrottledWrite");
  });

  it("待写期间的判定不重开窗口、无新动作", () => {
    const pending = syncStateMachine(initialSyncState(), { type: "judgement", at: 1000 })[0];
    const [state, action] = syncStateMachine(pending, { type: "judgement", at: 2500 });
    expect(state).toEqual(pending);
    expect(action).toBe("none");
  });

  it("节流到期转写中；写成功回空闲；成功后的新判定重新起窗", () => {
    const pending = syncStateMachine(initialSyncState(), { type: "judgement", at: 0 })[0];
    const writing = syncStateMachine(pending, { type: "throttleElapsed", at: 3000 })[0];
    expect(writing.phase).toBe("writing");
    const [idle, action] = syncStateMachine(writing, { type: "writeSucceeded" });
    expect(idle.phase).toBe("idle");
    expect(action).toBe("none");
    const again = syncStateMachine(idle, { type: "judgement", at: 5000 });
    expect(again[0].phase).toBe("pending");
  });

  it("写失败转积压并按退避安排重试；重试成功清积压", () => {
    const pending = syncStateMachine(initialSyncState(), { type: "judgement", at: 0 })[0];
    const writing = syncStateMachine(pending, { type: "throttleElapsed", at: 3000 })[0];
    const [backlog, action] = syncStateMachine(writing, { type: "writeFailed", at: 3100 });
    expect(backlog.phase).toBe("backlog");
    expect(backlog.retries).toBe(1);
    expect(action).toBe("scheduleRetry");
    // 重试又失败：退避翻倍
    const retrying = syncStateMachine(backlog, { type: "retryDue" })[0];
    expect(retrying.phase).toBe("writing");
    const [backlog2, action2] = syncStateMachine(retrying, { type: "writeFailed", at: 10000 });
    expect(backlog2.retries).toBe(2);
    expect(action2).toBe("scheduleRetry");
    const retrying2 = syncStateMachine(backlog2, { type: "retryDue" })[0];
    const [idle, action3] = syncStateMachine(retrying2, { type: "writeSucceeded" });
    expect(idle.phase).toBe("idle");
    expect(idle.retries).toBe(0);
    expect(action3).toBe("none");
  });

  it("积压期间新判定仍并入待写载荷（不重开重试计时），恢复在线立即冲写", () => {
    let [backlog] = syncStateMachine(initialSyncState(), { type: "judgement", at: 0 });
    backlog = syncStateMachine(backlog, { type: "throttleElapsed", at: 3000 })[0];
    backlog = syncStateMachine(backlog, { type: "writeFailed", at: 3100 })[0];
    const [state, action] = syncStateMachine(backlog, { type: "judgement", at: 4000 });
    expect(state).toEqual(backlog); // 状态不变，载荷由调用方合并
    expect(action).toBe("none");
    const [writing, action2] = syncStateMachine(backlog, { type: "backOnline", at: 4500 });
    expect(writing.phase).toBe("writing");
    expect(action2).toBe("none"); // 状态机已转入写中，实际写由监听方执行
  });

  it("写中收到判定写入保持写中（写完由 节流到期/写成功 流转）", () => {
    const pending = syncStateMachine(initialSyncState(), { type: "judgement", at: 0 })[0];
    const writing = syncStateMachine(pending, { type: "throttleElapsed", at: 3000 })[0];
    const [state, action] = syncStateMachine(writing, { type: "judgement", at: 3200 });
    expect(state.phase).toBe("writing");
    expect(action).toBe("none");
  });
});
