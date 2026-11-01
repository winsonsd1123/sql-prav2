// 云端域包写入路径（票 #57 / spec #53 目标②，ADR-0008）：
// 域包 JSON 以数据资产存 Supabase domain_pack_asset 表；写入前过验证闸门强校验
// （结构/生成/自判三类，#56 闸门）——落库即合法，浏览器读取路径只需契约快校验（性能取舍见
// src/components/cloud-domain-pack-store.ts 注释）。本票只提供写入服务函数与表结构，
// 教师端管理 API（#60）与版本化写入（#62）在其上扩展。
// 写入走 service_role 客户端（RLS 无写策略兜底，鉴权在 API 层，ADR-0007）。

import { parseDomainPackJson } from "@/kernel/domain-pack-contract";
import { validateDomainPack, type GateReport } from "@/kernel/domain-pack-gate";

/** 写入结果：闸门拒绝（带报告供教师端渲染）或落库失败（透出 Supabase 错误） */
export type UpsertDomainPackAssetResult =
  | { ok: true; packId: string }
  | { ok: false; kind: "gate"; report: GateReport }
  | { ok: false; kind: "storage"; message: string };

/** 结构化最小写客户端（service_role Supabase 客户端满足此形状；单测传桩） */
export interface DomainPackWriteClient {
  from(table: string): {
    upsert(rows: unknown): PromiseLike<{ error: { message: string } | null }>;
  };
}

/**
 * 域包入库：先闸门强校验（固定测试种子跑生成与自判，async），
 * 通过后 upsert 到 domain_pack_asset（pack_id 主键，当前最新版本即内容本身）。
 * 闸门拒绝不落库——保证表内资产恒为过闸门版本，学生端读取无需重跑生成级校验。
 */
export async function upsertDomainPackAsset(
  client: DomainPackWriteClient,
  json: unknown,
): Promise<UpsertDomainPackAssetResult> {
  const report = await validateDomainPack(json);
  if (!report.passed) return { ok: false, kind: "gate", report };
  // 闸门通过 ⇒ 契约解析必然成功；再解析一次只为取 packId（不再做重复校验语义）
  const parsed = parseDomainPackJson(json);
  if (!parsed.ok) {
    // 静默降级不可能分支的防御：闸门与契约对同一 JSON 的结论必须一致，不一致视为内部错误上抛
    throw new Error("闸门通过但契约解析失败：闸门与契约结论不一致");
  }
  const { error } = await client.from("domain_pack_asset").upsert({
    pack_id: parsed.pack.packId,
    asset: json,
  });
  if (error) return { ok: false, kind: "storage", message: error.message };
  return { ok: true, packId: parsed.pack.packId };
}
