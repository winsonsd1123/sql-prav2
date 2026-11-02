"use client";

// 学生端放出清单读取存储（issue #55 / spec #53 目标③）：
// 从 Supabase pack_exposure 表异步读取系统级放出清单，暴露为 useSyncExternalStore 可消费的外部存储。
// 快照语义（与过滤纯函数 src/lib/pack-exposure.ts 对齐）：
// - null = 未就绪 / 未配置 / 读取失败 → 均按「默认全放」渲染（向后兼容，升级后现有学生无感，首屏不闪错）；
// - Set = 已配置清单（可为空集合 = 有意全不放）。
// 域包注册表是模块级同步常量、本清单异步就绪——首帧以 null 全放渲染，就绪后过滤。

import { browserClient } from "@/lib/supabase/browser-client";

/** 放出清单快照：null 专指「未配置/未就绪」（与空集合「全不放」语义不同） */
export type PackExposureSnapshot = ReadonlySet<string> | null;

let snapshot: PackExposureSnapshot = null;
let loaded = false;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const subscriber of subscribers) subscriber();
}

/** 拉取一次放出清单（订阅即触发；已加载则不再拉）。表空 → 保持 null（未配置=全放）。 */
async function loadExposure(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const { data, error } = await browserClient().from("pack_exposure").select("pack_id");
    // 读取失败或云端报错：降级保持 null（全放），学生端可见性与升级前一致，不因清单服务故障白屏
    if (error) return;
    const rows = (data ?? []) as { pack_id: string }[];
    if (rows.length === 0) return;
    snapshot = new Set(rows.map((row) => row.pack_id));
    notify();
  } catch {
    // 网络异常同上：降级全放（静默降级意图：清单读不到时学生端按未配置渲染，不影响演练）
  }
}

/** 放出清单外部存储：subscribe 触发懒加载，getSnapshot 供 useSyncExternalStore */
export const packExposureStore = {
  subscribe(listener: () => void): () => void {
    subscribers.add(listener);
    void loadExposure();
    return () => subscribers.delete(listener);
  },
  getSnapshot(): PackExposureSnapshot {
    return snapshot;
  },
  /** SSR 快照：null（服务端按未配置=全放渲染，客户端就绪后过滤） */
  getServerSnapshot(): PackExposureSnapshot {
    return null;
  },
};

/** 仅供单测复位模块级状态（生产不使用） */
export function __resetPackExposureStoreForTest(): void {
  snapshot = null;
  loaded = false;
  subscribers.clear();
}
