"use client";

// T6 · 进度上云运行时（issue #28）：把 progress-sync-strategy 纯函数接到真实端口上。
// 判定结果落 localStorage（既有行为不变，即时缓存与断网兜底）之外，
// 节流约 3 秒静默写云端；断网/失败静默指数退避重试、恢复在线立即冲写，全程不弹 UI；
// 会话（种子+域包）就绪或切换时从云端拉取并按「云端为准」合并恢复完整进度
//（尝试次数 / SQL 草稿 / 通过状态 / 完成分档原始数据）。不迁移旧本地数据：
// 云端无记录时保留本地现状，云端为准仅作用于同键冲突。

import { browserClient } from "@/lib/supabase/browser-client";
import { seedStore, packStore, progressStore } from "@/components/session-store";
import { parseProgress } from "@/components/progress";
import {
  mergeProgress,
  createProgressThrottler,
  initialSyncState,
  syncStateMachine,
  retryBackoffMs,
  type SyncState,
} from "@/lib/progress-sync-strategy";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PROGRESS_TABLE = "practice_progress";
/** 节流窗口：每次判定后约 3 秒静默合并写（spec #22） */
export const CLOUD_WRITE_THROTTLE_MS = 3000;

/** 当前三元组会话标识（null = 种子未就绪，SSR/首帧） */
function sessionKey(): { userId: string; seed: number; packId: string } | null {
  const seed = seedStore.getSnapshot();
  if (seed === null) return null;
  return { userId: "", seed, packId: packStore.getSnapshot() };
}

/** 进度云同步协调器：创建后调用 start；stop 用于组件卸载清理 */
export function createProgressSync(
  userId: string,
  client: SupabaseClient = browserClient(),
): { start: () => void; stop: () => void } {
  let state: SyncState = initialSyncState();
  /** 已知云端内容基线（JSON 串）：进度等于基线不上写，防止恢复写回触发回环推送 */
  let baseline: string | null = null;
  /** 当前会话的三元组键（换一套/换域包后重置基线并重新拉取） */
  let currentKey: string | null = null;
  /** 云端拉取进行中：暂停推送，避免新会话尚未合并云端前把本地空进度推上去覆盖云端 */
  let fetching = false;
  let stopped = false;
  const cleanups: (() => void)[] = [];

  const tripleKey = () => {
    const s = sessionKey();
    return s === null ? null : { ...s, userId };
  };

  /** 云写（upsert，云端为准的同键覆盖写入）：成功记基线，失败走状态机静默重试 */
  const flushToCloud = async () => {
    if (stopped) return;
    const key = tripleKey();
    if (key === null) return;
    const progress = progressStore.getSnapshot();
    const { error } = await client
      .from(PROGRESS_TABLE)
      .upsert({ user_id: userId, seed: key.seed, pack_id: key.packId, progress });
    if (stopped) return;
    if (error === null) {
      baseline = JSON.stringify(progress);
      state = syncStateMachine(state, { type: "writeSucceeded" })[0];
    } else {
      const [nextState, action] = syncStateMachine(state, { type: "writeFailed", at: Date.now() });
      state = nextState;
      if (action === "scheduleRetry") scheduleRetry();
    }
  };

  const scheduleRetry = () => {
    if (state.phase !== "backlog") return;
    const delay = Math.max(0, state.nextRetryAt - Date.now());
    const timer = setTimeout(flushToCloud, Math.min(delay, retryBackoffMs(state.retries)));
    cleanups.push(() => clearTimeout(timer));
  };

  /** 节流器：写回调即触发云写（写中/积压由状态机与重试兜底） */
  const throttler = createProgressThrottler(flushToCloud, CLOUD_WRITE_THROTTLE_MS);

  /** 进度变化（判定/草稿/恢复写回）：等于基线不推；空闲/待写才排节流窗（写中不重开窗） */
  const onProgressChange = () => {
    if (stopped || fetching) return;
    const key = tripleKey();
    // 会话尚未做过云端恢复（首帧/换一套/换域包后的新键）：等恢复完成再推
    if (key === null || `${key.packId}:${key.seed}` !== currentKey) return;
    const snapshot = progressStore.getSnapshot();
    const serialized = JSON.stringify(snapshot);
    if (currentKey !== null && serialized === baseline) return; // 恢复写回或幂等变更，不上写
    const [nextState, action] = syncStateMachine(state, { type: "judgement", at: Date.now() });
    state = nextState;
    if (action === "scheduleThrottledWrite" || state.phase === "pending") throttler.schedule(snapshot);
    else if (state.phase === "backlog") throttler.schedule(snapshot); // 积压中刷新载荷，重试时取最新
  };

  /** 会话（种子+域包）就绪或切换：从云端拉取恢复（云端为准合并），换会话重置基线 */
  const restoreFromCloud = async () => {
    if (stopped) return;
    const key = tripleKey();
    if (key === null) return;
    const keyString = `${key.packId}:${key.seed}`;
    if (keyString === currentKey) return;
    currentKey = keyString;
    fetching = true;
    const { data, error } = await client
      .from(PROGRESS_TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("seed", key.seed)
      .eq("pack_id", key.packId)
      .maybeSingle();
    if (stopped || keyString !== currentKey) return; // 等待期间又换了会话，丢弃
    fetching = false;
    if (error !== null) return; // 拉取失败静默：保留本地（断网兜底），后续写仍以本地为准上推
    if (data === null) {
      baseline = null; // 云端无记录：不迁移、不清空本地
      return;
    }
    const cloudProgress = parseProgress(
      JSON.stringify((data as Record<string, unknown> | null)?.progress ?? null),
    );
    const local = progressStore.getSnapshot();
    const merged = mergeProgress(local, cloudProgress);
    baseline = JSON.stringify(merged); // 恢复写回不触发推送
    if (JSON.stringify(merged) !== JSON.stringify(local)) progressStore.write(merged);
  };

  const flushOnBackOnline = () => {
    if (state.phase !== "backlog") return;
    state = syncStateMachine(state, { type: "backOnline", at: Date.now() })[0];
    throttler.flush();
  };

  return {
    start: () => {
      cleanups.push(progressStore.subscribe(() => onProgressChange()));
      cleanups.push(seedStore.subscribe(() => void restoreFromCloud()));
      cleanups.push(packStore.subscribe(() => void restoreFromCloud()));
      window.addEventListener("online", flushOnBackOnline);
      cleanups.push(() => window.removeEventListener("online", flushOnBackOnline));
      const flushOnUnload = () => throttler.flush();
      window.addEventListener("beforeunload", flushOnUnload);
      cleanups.push(() => window.removeEventListener("beforeunload", flushOnUnload));
      void restoreFromCloud();
    },
    stop: () => {
      stopped = true;
      throttler.flush();
      while (cleanups.length) cleanups.pop()!();
    },
  };
}
