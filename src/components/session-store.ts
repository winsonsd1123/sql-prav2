"use client";

/**
 * 会话级本地状态（code-review #1 从演练场拆出）：
 * 种子 / 域包 / 进度 三套状态各为一个基于 createLocalStorage 的外部存储，
 * 共享同一通知总线（任一写入唤醒全部订阅者——进度键由种子与域包推导，
 * 换一套或换域包后进度须立即按新键重载，等价于重置）。
 * 演练场组件只负责 UI 编排，通过 useSyncExternalStore 消费这些存储。
 */

import { createLocalStorage } from "@/components/local-storage";
import { emptyProgress, progressKey, parseProgress, type ProgressRecord } from "@/components/progress";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";
import { loadPackB } from "@/domain-packs/employee-department-salary/pack-b";
import type { DomainPack } from "@/kernel/types";

// 域包注册表：学生可在两个业务域之间切换练习（issue #8）
export const domainPackRegistry: DomainPack[] = [loadPackA(), loadPackB()];

const SEED_KEY = "sql-playground:seed";
const PACK_KEY = "sql-playground:pack";

// 共享订阅集合：三套存储共用——任一存储写入，唤醒全部订阅者
const subscribers = new Set<() => void>();

/** 种子外部存储：URL 参数优先于 localStorage，均缺省则生成新种子并同步两者；
 * 客户端快照恒为 number，null 仅出现在 SSR */
export const seedStore = createLocalStorage<number | null>({
  getKey: () => SEED_KEY,
  init: (raw): number => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("seed");
      if (fromUrl && /^\d+$/.test(fromUrl)) {
        const n = Number(fromUrl);
        localStorage.setItem(SEED_KEY, String(n));
        return n;
      }
      if (raw && /^\d+$/.test(raw)) return Number(raw);
    }
    // 首次进入：生成新种子，持久化并写入 URL
    const newSeed = Math.floor(Math.random() * 1_000_000_000);
    localStorage.setItem(SEED_KEY, String(newSeed));
    window.history.replaceState(null, "", `?seed=${newSeed}`);
    return newSeed;
  },
  serialize: String,
  notReadySnapshot: null,
  subscribers,
});

/** 当前域包ID外部存储：非法值回退到域包A */
export const packStore = createLocalStorage<string>({
  getKey: () => PACK_KEY,
  init: (raw) =>
    domainPackRegistry.some((d) => d.packId === raw) ? raw! : domainPackRegistry[0].packId,
  serialize: (v) => v,
  notReadySnapshot: domainPackRegistry[0].packId,
  subscribers,
});

/** 进度外部存储：键随会话（域包+种子）派生，键变化时惰性重载，等价于换会话重置 */
export const progressStore = createLocalStorage<ProgressRecord>({
  getKey: () => {
    const seed = seedStore.getSnapshot();
    return seed === null ? null : progressKey(packStore.getSnapshot(), seed);
  },
  init: parseProgress,
  serialize: (value) => JSON.stringify(value),
  notReadySnapshot: emptyProgress,
  subscribers,
});

/** 进度迁移写回：读取当前进度 → 迁移 → 持久化并通知 */
export function migrateProgress(migrate: (p: ProgressRecord) => ProgressRecord): void {
  progressStore.write(migrate(progressStore.getSnapshot()));
}

/** 草稿防抖保存器（issue #15）：编辑器逐键变更只在静默窗口后写一次进度，
 * 避免逐键同步写 localStorage；切题/卸载前调用 flushNow 落盘最后一次编辑。
 * 写入函数注入以便单测（真实使用见 演练场 的 保存草稿）。 */
export function createDraftSaver(
  writeFn: (questionIndex: number, sql: string) => void,
  debounceMs = 500,
): { schedule: (questionIndex: number, sql: string) => void; flushNow: () => void } {
  let pendingWrite: { questionIndex: number; sql: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (pendingWrite === null) return;
    const { questionIndex, sql } = pendingWrite;
    pendingWrite = null;
    writeFn(questionIndex, sql);
  };
  return {
    schedule: (questionIndex, sql) => {
      pendingWrite = { questionIndex, sql };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    flushNow: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
  };
}

/** 换一套：生成新种子（保留域包，同域包下换一套库与题），并同步 URL */
export function regenerateSession(): void {
  const newSeed = Math.floor(Math.random() * 1_000_000_000);
  seedStore.write(newSeed);
  window.history.replaceState(null, "", `?seed=${newSeed}`);
}

/** 切换域包：保留种子，只换业务域（同种子下两域包生成各自的库与题） */
export function setPack(packId: string): void {
  packStore.write(packId);
}

/** 库实例名：随会话种子确定性派生的库展示标签（同一种子必得同名，非随机名） */
export function instanceLabel(seed: number): string {
  return `practice_${String(seed).padStart(9, "0").slice(-4)}`;
}
