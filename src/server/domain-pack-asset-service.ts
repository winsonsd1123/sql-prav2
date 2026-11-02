// 云端域包写入路径（票 #57 / spec #53 目标②，ADR-0008）：
// 域包 JSON 以数据资产存 Supabase domain_pack_asset 表；写入前过验证闸门强校验
// （结构/生成/自判三类，#56 闸门）——落库即合法，浏览器读取路径只需契约快校验（性能取舍见
// src/components/cloud-domain-pack-store.ts 注释）。本票只提供写入服务函数与表结构，
// 教师端管理 API（#60）与版本化写入（#62）在其上扩展。
// 写入走 service_role 客户端（RLS 无写策略兜底，鉴权在 API 层，ADR-0007）。

import { parseDomainPackJson } from "@/kernel/domain-pack-contract";
import { validateDomainPack, type GateReport } from "@/kernel/domain-pack-gate";
import { serverPrivilegedClient } from "@/lib/supabase/server-client";

/** 写入结果：闸门拒绝（带报告供教师端渲染）、词表拒绝（引用形态语义校验，透出中文原因）或落库失败（透出 Supabase 错误） */
export type UpsertDomainPackAssetResult =
  | { ok: true; packId: string }
  | { ok: false; kind: "gate"; report: GateReport }
  | { ok: false; kind: "vocabulary"; message: string }
  | { ok: false; kind: "storage"; message: string };

/** 结构化最小写客户端（service_role Supabase 客户端满足此形状；单测传桩） */
export interface DomainPackWriteClient {
  from(table: string): {
    upsert(rows: unknown): PromiseLike<{ error: { message: string } | null }>;
  };
}

/**
 * 知识点词表接缝（#83 / ADR 0010）：引用形态写入路径的语义校验依赖——
 * 词表条目现状（引用存在 / 名称对齐 / 停用判定）与该域包当前的既有引用
 * （停用条目不可被「新圈选」，既有引用不受停用影响）。
 */
export interface KnowledgeAreaVocabSeam {
  /** 词表全量条目（id / 名称 / 启停态） */
  fetchKnowledgeAreaEntries(): Promise<{ id: string; name: string; active: boolean }[]>;
  /** 该域包当前落库资产的引用数组；无行或自由形态返回 null */
  fetchCurrentRefIds(packId: string): Promise<string[] | null>;
}

/** 写入路径依赖：词表接缝可选注入（单测传桩）；缺省用 service_role 客户端拼装 */
export interface UpsertDomainPackAssetDeps {
  vocab?: KnowledgeAreaVocabSeam;
}

/** 缺省词表接缝：service_role 读 knowledge_area 全量 + 该域包当前资产行 */
export function defaultVocabSeam(): KnowledgeAreaVocabSeam {
  return {
    fetchKnowledgeAreaEntries: async () => {
      const { data, error } = await serverPrivilegedClient()
        .from("knowledge_area")
        .select("id,name,active");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string; active: boolean }[];
    },
    fetchCurrentRefIds: async (packId) => {
      const { data, error } = await serverPrivilegedClient()
        .from("domain_pack_asset")
        .select("asset")
        .eq("pack_id", packId)
        .maybeSingle();
      if (error || data === null) return null;
      const refIds = (data.asset as { knowledgeAreaRefIds?: unknown } | null)?.knowledgeAreaRefIds;
      return Array.isArray(refIds) ? (refIds as string[]) : null;
    },
  };
}

/**
 * 引用形态词表语义校验（闸门之后、落库之前）：
 * ① 引用必须存在于词表（防悬挂引用）；② 名称清单必须与词表条目逐位对齐
 * （落库即归一化——读取端一律读名称，两形态行为一致）；
 * ③ 相对既有引用「新增」的引用不可指向停用条目（停用不可被新圈选，既有引用不受影响）。
 * 返回 null = 通过；否则返回中文拒绝原因。
 */
export async function checkKnowledgeAreaReferences(
  pack: { packId: string; knowledgeAreas: string[]; knowledgeAreaRefIds?: string[] },
  vocab: KnowledgeAreaVocabSeam,
): Promise<string | null> {
  const refIds = pack.knowledgeAreaRefIds;
  if (refIds === undefined) return null;

  const entries = await vocab.fetchKnowledgeAreaEntries();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const currentRefIds = new Set((await vocab.fetchCurrentRefIds(pack.packId)) ?? []);

  for (const [i, refId] of refIds.entries()) {
    const entry = byId.get(refId);
    if (entry === undefined) {
      return `知识点词表引用不存在：${refId}（第 ${i + 1} 项）`;
    }
    if (pack.knowledgeAreas[i] !== entry.name) {
      return `知识点清单第 ${i + 1} 项「${pack.knowledgeAreas[i]}」与词表条目「${entry.name}」名称不一致（落库须与词表逐位对齐）`;
    }
    if (!currentRefIds.has(refId) && !entry.active) {
      return `知识点「${entry.name}」已停用，不能再被新圈选（可改用停用前保留既有引用或重新启用）`;
    }
  }
  return null;
}

/**
 * 域包入库：先闸门强校验（固定测试种子跑生成与自判，async），
 * 通过后 upsert 到 domain_pack_asset（pack_id 主键，当前最新版本即内容本身）。
 * 闸门拒绝不落库——保证表内资产恒为过闸门版本，学生端读取无需重跑生成级校验。
 */
export async function upsertDomainPackAsset(
  client: DomainPackWriteClient,
  json: unknown,
  deps: UpsertDomainPackAssetDeps = {},
): Promise<UpsertDomainPackAssetResult> {
  const report = await validateDomainPack(json);
  if (!report.passed) return { ok: false, kind: "gate", report };
  // 闸门通过 ⇒ 契约解析必然成功；再解析一次只为取 packId（不再做重复校验语义）
  const parsed = parseDomainPackJson(json);
  if (!parsed.ok) {
    // 静默降级不可能分支的防御：闸门与契约对同一 JSON 的结论必须一致，不一致视为内部错误上抛
    throw new Error("闸门通过但契约解析失败：闸门与契约结论不一致");
  }
  // 引用形态（#83）：词表语义校验（引用存在 / 名称对齐 / 停用不可新圈选），拒绝不落库
  const vocab = deps.vocab ?? defaultVocabSeam();
  const vocabMessage = await checkKnowledgeAreaReferences(parsed.pack, vocab);
  if (vocabMessage !== null) return { ok: false, kind: "vocabulary", message: vocabMessage };
  const { error } = await client.from("domain_pack_asset").upsert({
    pack_id: parsed.pack.packId,
    asset: json,
  });
  if (error) return { ok: false, kind: "storage", message: error.message };
  return { ok: true, packId: parsed.pack.packId };
}
