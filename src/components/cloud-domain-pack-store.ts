"use client";

// 学生端云端域包读取存储（票 #57 / spec #53 目标②，ADR-0008）：
// 从 Supabase domain_pack_asset 表异步拉取域包资产，暴露为 useSyncExternalStore 可消费的外部存储。
// 快照语义：
// - { packs: [], loaded: false } = 未就绪——学生端仅见内置两包（首屏不闪错，#55 放出清单同款策略）；
// - { packs, loaded: true } = 就绪——packs 只含通过收录检查的域包。
// 读取路径收录检查 = 契约快校验（parseDomainPackJson）+ 抽题兼容检查；不做生成级闸门——
// 性能取舍：闸门（固定种子跑生成/自判，async 且秒级）在写入路径强校验（upsertDomainPackAsset
// 落库即合法），浏览器每次会话拉取都跑生成级校验代价不可接受；契约快校验是同步毫秒级，
// 兜住「绕过写入服务的脏数据」不进加载结果。

import { browserClient } from "@/lib/supabase/browser-client";
import { parseDomainPackJson, assetToKernelPack } from "@/kernel/domain-pack-contract";
import type { DomainPack } from "@/kernel/types";

/** 云端域包清单快照：loaded 区分「未就绪」与「就绪但云端没有可收录域包」 */
export interface CloudPackSnapshot {
  packs: DomainPack[];
  loaded: boolean;
}

let snapshot: CloudPackSnapshot = { packs: [], loaded: false };
let loaded = false;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const subscriber of subscribers) subscriber();
}

/**
 * 收录检查（读取路径）：契约快校验通过，且模板覆盖域包自带知识点清单的全部条目——
 * 清单里有条目而无模板的域包一开练就会在抽题处抛错（question-picking 每知识点保底 1 题）。
 * 票 #58 知识点顺序下放域包字段后，原「覆盖全局七类」过渡防线随之解除：
 * 各包只需覆盖自己的清单即可开练。
 */
function toLoadablePack(json: unknown): DomainPack | null {
  const parsed = parseDomainPackJson(json);
  if (!parsed.ok) return null;
  const covered = new Set(parsed.pack.templates.map((t) => t.knowledgeArea));
  for (const area of parsed.pack.knowledgeAreas) {
    if (!covered.has(area)) return null;
  }
  return assetToKernelPack(parsed.pack);
}

/** 拉取一次云端域包清单（订阅即触发；已加载则不再拉）。失败/脏行降级剔除，学生端不受影响。 */
async function loadCloudPacks(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const { data, error } = await browserClient()
      .from("domain_pack_asset")
      .select("pack_id, asset");
    if (error) {
      // 静默降级意图：云端读取失败 → 空清单 + 就绪（学生端只见内置两包，与升级前一致，不白屏不闪错）
      snapshot = { packs: [], loaded: true };
      notify();
      return;
    }
    const packs: DomainPack[] = [];
    for (const row of (data ?? []) as { pack_id: string; asset: unknown }[]) {
      // 静默降级意图：非法/不兼容的脏行剔除不收录（闸门拒绝的域包不进入加载结果），其余行照常收录
      const pack = toLoadablePack(row.asset);
      if (pack !== null && !packs.some((d) => d.packId === pack.packId)) packs.push(pack);
    }
    snapshot = { packs, loaded: true };
    notify();
  } catch {
    // 网络异常同上：降级空清单（学生端按仅内置两包继续演练）
    snapshot = { packs: [], loaded: true };
    notify();
  }
}

/** 云端域包外部存储：subscribe 触发懒加载，getSnapshot 供 useSyncExternalStore */
export const cloudPackStore = {
  subscribe(listener: () => void): () => void {
    subscribers.add(listener);
    void loadCloudPacks();
    return () => subscribers.delete(listener);
  },
  getSnapshot(): CloudPackSnapshot {
    return snapshot;
  },
  /** SSR 快照：服务端无云端，恒为未就绪（仅内置两包） */
  getServerSnapshot(): CloudPackSnapshot {
    return { packs: [], loaded: false };
  },
  /** 管理页发布新域包后强制重拉（票 #60）：清就绪标记再懒加载，订阅者收最新清单 */
  forceReload(): void {
    loaded = false;
    void loadCloudPacks();
  },
};

/** 仅供单测复位模块级状态（生产不使用） */
export function __resetCloudPackStoreForTest(): void {
  snapshot = { packs: [], loaded: false };
  loaded = false;
  subscribers.clear();
}
