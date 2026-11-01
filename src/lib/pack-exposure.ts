// 域包放出过滤（issue #55 / spec #53 目标③，GLOSSARY「域包放出」）：
// 学生端可演练列表 = 域包注册表 ∩ 系统级放出清单，过滤语义收口为本纯函数（后续票复用）。
// 未配置（null）默认全部放出：向后兼容，升级后现有学生无感；
// 空清单是合法配置（一项不放）；清单含注册表之外的 id 静默忽略（清单可先行登记未上线的域包）。

import type { DomainPack } from "@/kernel/types";

/**
 * 放出清单查询结构：已配置的 packId 集合。
 * null 专指「未配置/未就绪」——与空集合（配置为全不放）语义不同。
 */
export type ExposedPackLookup = ReadonlySet<string>;

/** 域包注册表 × 放出清单 → 学生可见列表；顺序保持注册表顺序 */
export function filterExposedPacks(
  registry: readonly DomainPack[],
  exposed: ExposedPackLookup | null,
): DomainPack[] {
  // 未配置（或清单尚未加载就绪）= 默认全放
  if (exposed === null) return [...registry];
  return registry.filter((pack) => exposed.has(pack.packId));
}
