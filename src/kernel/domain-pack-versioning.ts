// 域包版本化纯函数（票 #62 / ADR-0009）：packId 版本后缀解析/构造、A/B 类改动分类。
// 约定（与 supabase/migrations/20261101000002 版本历史表注释一致）：
// - packId 基础名永不更改（改名会使云端进度三元组键成为孤儿行）；
// - 首发版本（v1）packId 即基础名、无后缀；B 类修改产生 vN（N≥2），packId = 基础名@vN；
// - A 类改动（难度档位定义 / 演练配置 / 场景名，不参与种子生成）即时生效、packId 不变、不产生版本。
// 分类依据 = 修改是否触及参与种子生成的内容（库骨架 / 名称池 / 题目模板 / 知识点清单），
// 比较走稳定序列化（键序无关），LLM 重排 JSON 键序不误判为改动。

import type { DomainPackAsset } from "./domain-pack-contract";

/** packId 解析结果：基础名 + 版本号（首发 v1，无后缀） */
export interface PackIdVersion {
  base: string;
  version: number;
}

/**
 * 解析 packId 的基础名与版本号。
 * 非法后缀形式（@v2x、@v0、@va 等）不视为版本后缀——整体作为基础名、版本 1，
 * 与「packId 非空字符串」的宽松契约一致，不在此抛错。
 */
export function parsePackIdVersion(packId: string): PackIdVersion {
  const match = /^(.*)@v(\d+)$/.exec(packId);
  if (match === null) return { base: packId, version: 1 };
  const version = Number(match[2]);
  if (version < 2 || !Number.isSafeInteger(version)) return { base: packId, version: 1 };
  return { base: match[1], version };
}

/** 构造带版本号的 packId：v1 即基础名（无后缀），vN（N≥2）加 @vN 后缀 */
export function buildVersionedPackId(base: string, version: number): string {
  return version <= 1 ? base : `${base}@v${version}`;
}

/** A/B 类改动分类结果（GLOSSARY「域包版本」） */
export type DomainPackChangeClass = "A" | "B" | "unchanged";

/**
 * 稳定序列化：对象键递归排序后序列化，比较与键序无关。
 * 导出供版本轻量 diff（票 #88）复用，键序无关比较口径单一真理源。
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A/B 类改动分类（服务端 diff 判定，不信任 LLM 自报）：
 * - B 类：参与种子生成的内容（schemaSkeleton 库骨架与名称池 / templates 题目模板 /
 *   knowledgeAreas 有序知识点清单）任一变化——同种子的题目序列会漂移，须产生新版本；
 * - A 类：仅场景名 / 难度档位定义（difficultyTiers）/ 演练配置（practiceConfig）变化——
 *   不参与种子生成，即时生效、packId 不变；
 * - unchanged：完全相同（含键序重排）。
 * packId 本身的变化不参与分类：基础名不可改，由调用方先行拦截。
 */
export function classifyDomainPackChange(
  current: DomainPackAsset,
  draft: DomainPackAsset,
): DomainPackChangeClass {
  // 知识点清单双形态（#83 / ADR 0010）：名称清单与词表引用数组作为一个种子字段整体比较——
  // 引用数组变化（含引用↔自由形态切换）即清单变化 → B 类；仅 A 类字段变 → A 类（分界不变）
  const seedFields = [
    current.schemaSkeleton,
    current.templates,
    { knowledgeAreas: current.knowledgeAreas, knowledgeAreaRefIds: current.knowledgeAreaRefIds ?? null },
  ] as const;
  const draftFields = [
    draft.schemaSkeleton,
    draft.templates,
    { knowledgeAreas: draft.knowledgeAreas, knowledgeAreaRefIds: draft.knowledgeAreaRefIds ?? null },
  ] as const;
  const seedChanged = seedFields.some((field, i) => stableStringify(field) !== stableStringify(draftFields[i]));
  if (seedChanged) return "B";
  const aChanged =
    stableStringify(current.name) !== stableStringify(draft.name) ||
    stableStringify(current.difficultyTiers) !== stableStringify(draft.difficultyTiers) ||
    stableStringify(current.practiceConfig) !== stableStringify(draft.practiceConfig);
  return aChanged ? "A" : "unchanged";
}
