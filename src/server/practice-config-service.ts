// 演练配置编辑服务（票 #61 / spec #53 目标②，ADR-0009「A 类改动」/ ADR-0007 鉴权在服务层）：
// 演练配置（总题数 + 各难度档位分布）不参与种子生成，编辑即时生效、packId 不变、不产生版本历史行。
// - 视图：内置两包为底（表里未配置也能编辑），云端 domain_pack_asset 同 id 行的 practiceConfig 覆盖当前值；
// - 保存：服务端重校验（不信任前端）——载荷替换进整包资产后走 #56 契约校验
//   （总和一致、档位 "1"-"5"、非负、各档配额 ≤ 该档模板数，错误为契约中文信息），
//   再复用 #57 upsertDomainPackAsset（整包过闸门落库，「落库即合法」不变式延续；管理端编辑低频，
//   秒级闸门代价可接受，换来与发布路径完全同一写入管线，无需另开细粒度更新路径）。
// 鉴权：authorizeAdminRequest 双权限点（「访问后台」+「域包管理」，与放出管理一致）。

import { authorizeAdminRequest, defaultAdminDeps, type AdminDeps } from "@/server/admin-service";
import { PERMISSIONS } from "@/lib/permissions";
import { parseDomainPackJson, type DomainPackAsset } from "@/kernel/domain-pack-contract";
import type { PracticeConfiguration } from "@/kernel/types";
import { upsertDomainPackAsset, type DomainPackWriteClient } from "@/server/domain-pack-asset-service";
import { builtinPackAssets } from "@/domain-packs/builtin-packs";
import { serverPrivilegedClient } from "@/lib/supabase/server-client";
import type { GateReport } from "@/kernel/domain-pack-gate";

/** 配置视图条目：当前配置 + 各档模板数（界面提示「配额不得超过该档模板数」用） */
export interface PracticeConfigViewEntry {
  packId: string;
  name: string;
  practiceConfig: PracticeConfiguration;
  /** 各档位现有模板数，键 "1"-"5" */
  tierTemplateCounts: Record<string, number>;
}

export type PracticeConfigViewResult =
  | { status: "ok"; packs: PracticeConfigViewEntry[] }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "error" };

export type PracticeConfigSaveResult =
  | { status: "ok"; packId: string; practiceConfig: PracticeConfiguration }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "invalid"; errors: string[] }
  | { status: "gate"; report: GateReport }
  | { status: "error"; message: string };

/** 结构化最小读客户端（service_role Supabase 客户端满足此形状；单测传桩） */
export interface DomainPackReadClient {
  from(table: string): {
    select(query: string): PromiseLike<{ data: { pack_id: string; asset: unknown }[] | null; error: { message: string } | null }>;
  };
}

/** 可注入依赖（测试接缝）：鉴权链 / 云端读客户端 / 云端写客户端 */
export interface PracticeConfigServiceDeps {
  adminDeps?: AdminDeps;
  readClient?: DomainPackReadClient;
  writeClient?: DomainPackWriteClient;
}

/** 资产 → 视图条目（含各档模板计数） */
function toEntry(asset: DomainPackAsset): PracticeConfigViewEntry {
  const tierTemplateCounts: Record<string, number> = {};
  for (let level = 1; level <= 5; level++) tierTemplateCounts[String(level)] = 0;
  for (const template of asset.templates) {
    tierTemplateCounts[String(template.difficulty)] += 1;
  }
  return { packId: asset.packId, name: asset.name, practiceConfig: asset.practiceConfig, tierTemplateCounts };
}

/** 云端行集 → packId → 合法资产（脏行剔除不进视图） */
function toAssetMap(rows: { pack_id: string; asset: unknown }[]): Map<string, DomainPackAsset> {
  const map = new Map<string, DomainPackAsset>();
  for (const row of rows) {
    const parsed = parseDomainPackJson(row.asset);
    if (parsed.ok) map.set(parsed.pack.packId, parsed.pack);
  }
  return map;
}

/** 拉取云端资产行集；读取失败返回 null（调用方降级为仅内置清单） */
async function fetchCloudAssets(client: DomainPackReadClient): Promise<Map<string, DomainPackAsset> | null> {
  const { data, error } = await client.from("domain_pack_asset").select("pack_id, asset");
  if (error || data === null) return null;
  return toAssetMap(data);
}

/** 配置视图（GET）：内置两包为底，云端同 id 行覆盖当前配置 */
export async function getPracticeConfigView(
  authorization: string | null,
  deps: PracticeConfigServiceDeps = {},
): Promise<PracticeConfigViewResult> {
  const auth = await authorizeAdminRequest(authorization, deps.adminDeps ?? defaultAdminDeps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return auth;
  try {
    let cloud = new Map<string, DomainPackAsset>();
    try {
      const fetched = await fetchCloudAssets(deps.readClient ?? serverPrivilegedClient());
      if (fetched !== null) cloud = fetched;
    } catch {
      // 静默降级意图：云端读取异常时按仅内置清单渲染视图（教师仍可编辑并保存，保存走完整校验）
      cloud = new Map();
    }
    const packs = builtinPackAssets.map((builtin) => {
      const cloudAsset = cloud.get(builtin.packId);
      return cloudAsset === undefined ? toEntry(builtin) : toEntry({ ...builtin, practiceConfig: cloudAsset.practiceConfig });
    });
    return { status: "ok", packs };
  } catch {
    return { status: "error" };
  }
}

/** 保存载荷形状预检：{ packId, practiceConfig } 且 practiceConfig 为对象 */
function normalizeSavePayload(body: unknown): { packId: string; practiceConfig: Record<string, unknown> } | null {
  if (typeof body !== "object" || body === null) return null;
  const { packId, practiceConfig } = body as { packId?: unknown; practiceConfig?: unknown };
  if (typeof packId !== "string" || packId.trim() === "") return null;
  if (typeof practiceConfig !== "object" || practiceConfig === null || Array.isArray(practiceConfig)) return null;
  return { packId: packId.trim(), practiceConfig: practiceConfig as Record<string, unknown> };
}

/** 保存（PUT）：云端现行资产为底（无云端行则内置资产）→ 替换 practiceConfig → 契约校验 → 闸门落库 */
export async function savePracticeConfig(
  body: unknown,
  authorization: string | null,
  deps: PracticeConfigServiceDeps = {},
): Promise<PracticeConfigSaveResult> {
  const payload = normalizeSavePayload(body);
  if (payload === null) return { status: "invalid", errors: ["请求体必须是 { packId, practiceConfig }"] };

  const auth = await authorizeAdminRequest(authorization, deps.adminDeps ?? defaultAdminDeps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return auth;

  try {
    let current: DomainPackAsset | undefined = builtinPackAssets.find((a) => a.packId === payload.packId);
    try {
      const cloud = await fetchCloudAssets(deps.readClient ?? serverPrivilegedClient());
      if (cloud !== null) current = cloud.get(payload.packId) ?? current;
    } catch {
      // 静默降级意图：云端读取异常时回退内置资产为底（内置包仍可保存；云端包保存前读取失败
      // 会因找不到底稿被 not_found 拦下，不会写坏数据）
    }
    if (current === undefined) return { status: "not_found" };

    const merged = { ...current, practiceConfig: payload.practiceConfig };
    const parsed = parseDomainPackJson(merged);
    if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

    const written = await upsertDomainPackAsset(deps.writeClient ?? serverPrivilegedClient(), merged);
    if (written.ok) return { status: "ok", packId: written.packId, practiceConfig: parsed.pack.practiceConfig };
    if (written.kind === "gate") return { status: "gate", report: written.report };
    return { status: "error", message: written.message };
  } catch {
    return { status: "error", message: "保存演练配置失败" };
  }
}
