// 域包微调与版本化编排服务（票 #62 / spec #53 目标②，ADR-0009 / ADR-0007）：
// 微调 = 服务端取当前资产（云端行，缺则内置 JSON）+ 修改意图 → LLM 修改后完整 JSON
//   → #56 闸门 → 服务端 diff 判定 A/B 类 → 同步返回 {草稿, 报告, 分类, 版本预告}；
// 确认生效 = 服务端重过闸门 + 重判分类（不信任前端）——
//   A 类（仅名称/难度档位定义/演练配置变）：直接更新当前资产行，packId 不变、不写版本历史；
//   B 类（库骨架/名称池/模板/知识点清单变）：产生新版本——草稿 packId 由服务端改写为
//     基础名@vN（N = 当前版本 + 1），旧资产写入 domain_pack_version_history 供旧会话加载，
//     当前行（pack_id = 基础名）更新为新资产。进行中会话的旧 packId 经加载层解析到历史内容，
//     进度/草稿键含 packId 文本 → 新旧自动隔离，零迁移（ADR-0009）。
// 基础名永不改：草稿改了基础名直接拒绝（改名会使云端进度三元组键成为孤儿行）。
// 鉴权在服务层收口：authorizeAdminRequest 双权限点（「访问后台」+「域包管理」）。

import { authorizeAdminRequest, defaultAdminDeps, type AdminDeps } from "@/server/admin-service";
import { PERMISSIONS } from "@/lib/permissions";
import { buildRefinePrompt } from "@/server/domain-pack-prompt";
import type { LlmProvider } from "@/server/llm-provider";
import { LlmProviderError } from "@/server/llm-provider";
import { validateDomainPack, type GateReport } from "@/kernel/domain-pack-gate";
import { parseDomainPackJson, type DomainPackAsset } from "@/kernel/domain-pack-contract";
import {
  parsePackIdVersion,
  buildVersionedPackId,
  classifyDomainPackChange,
  type DomainPackChangeClass,
} from "@/kernel/domain-pack-versioning";
import { builtinPackAssets } from "@/domain-packs/builtin-packs";
import { serverPrivilegedClient } from "@/lib/supabase/server-client";
import { checkKnowledgeAreaReferences, defaultVocabSeam, type KnowledgeAreaVocabSeam } from "@/server/domain-pack-asset-service";

/** 可注入依赖（测试接缝）：LLM provider（apply 不需要）/ 鉴权链 / 云端读写客户端 / 知识点词表接缝 */
export interface RefineServiceDeps {
  provider?: LlmProvider;
  adminDeps?: AdminDeps;
  readClient?: RefineReadClient;
  writeClient?: DomainPackWriteClient;
  /** 词表语义校验接缝（#83 引用形态；缺省用 service_role 客户端拼装） */
  vocabSeam?: KnowledgeAreaVocabSeam;
}

/** 结构化最小读客户端（service_role Supabase 客户端满足此形状；单测传桩） */
export interface RefineReadClient {
  from(table: string): {
    select(query: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  };
}

/** 结构化最小写客户端（与 #57 asset-service 同形，upsert 目标表可切换） */
export interface DomainPackWriteClient {
  from(table: string): {
    upsert(rows: unknown): PromiseLike<{ error: { message: string } | null }>;
  };
}

/** 当前资产解析结果：版本号取自资产自身 packId（首发 v1 无后缀） */
interface CurrentAsset {
  asset: DomainPackAsset;
  version: number;
}

export type RefineDraftResult =
  | {
      status: "ok";
      draft: unknown;
      report: GateReport;
      /** 服务端 diff 判定的改动分类（不信任 LLM 自报） */
      changeClass: DomainPackChangeClass;
      /** 当前版本号（如 v1） */
      currentVersionLabel: string;
      /** 确认生效将到达的版本号：B 类 = 下一版本；A 类 = 当前版本（不产生新版本） */
      nextVersionLabel: string;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "llm_error"; kind: "network" | "api" | "empty" | "unknown"; message: string }
  | { status: "llm_invalid_json"; message: string };

export type ApplyRefinementResult =
  | { status: "ok"; packId: string; changeClass: "A" | "B"; versionLabel: string }
  | { status: "gate"; report: GateReport }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "base_name_changed"; actualBasePackId: string }
  | { status: "no_change" }
  /** 引用形态草稿词表语义校验不通过（#83）：引用不存在 / 名称不对齐 / 新圈选停用条目 */
  | { status: "vocabulary"; message: string }
  | { status: "error"; message: string };

/** 版本历史条目（管理页「版本历史」区块渲染口径） */
export interface DomainPackVersionEntry {
  /** 该版本的完整 packId（v1 即基础名，vN≥2 带 @vN 后缀） */
  packId: string;
  versionLabel: string;
  name: string;
  createdAt: string | null;
  isCurrent: boolean;
}

export type VersionHistoryResult =
  | { status: "ok"; versions: DomainPackVersionEntry[] }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "error" };

/** 微调请求体形状预检：{ packId, intent, sampleSql? }，意图必填非空 */
function normalizeRefineInput(
  body: unknown,
): { packId: string; intent: string; sampleSql?: string; targetTemplateId?: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as { packId?: unknown; intent?: unknown; sampleSql?: unknown; targetTemplateId?: unknown };
  if (typeof raw.packId !== "string" || raw.packId.trim() === "") return null;
  if (typeof raw.intent !== "string" || raw.intent.trim() === "") return null;
  if (raw.sampleSql !== undefined && typeof raw.sampleSql !== "string") return null;
  // 元素微调目标（票 #85）：可选；给定时必须是字符串（空串视为未指定）
  if (raw.targetTemplateId !== undefined && typeof raw.targetTemplateId !== "string") return null;
  const targetTemplateId = raw.targetTemplateId?.trim();
  return {
    packId: raw.packId.trim(),
    intent: raw.intent,
    sampleSql: raw.sampleSql,
    ...(targetTemplateId !== "" && targetTemplateId !== undefined ? { targetTemplateId } : {}),
  };
}

/**
 * 解析目标基础名的当前资产：优先云端当前行（pack_id = 基础名，含内置包的
 * 演练配置覆盖快照——#61 起「云端行与内置资产同源」写入纪律保证底本不漂移）；
 * 云端无行时回退内置静态 JSON（内置包微调也走同一版本化路径，内置 JSON 本身永不改）。
 */
async function resolveCurrentAsset(
  client: RefineReadClient,
  basePackId: string,
): Promise<CurrentAsset | null> {
  const builtin = builtinPackAssets.find((a) => a.packId === basePackId);
  let asset: DomainPackAsset | undefined = builtin;
  try {
    const { data, error } = await client.from("domain_pack_asset").select("pack_id, asset");
    if (!error && data !== null) {
      const row = (data as { pack_id: string; asset: unknown }[]).find((r) => r.pack_id === basePackId);
      if (row !== undefined) {
        const parsed = parseDomainPackJson(row.asset);
        if (parsed.ok) asset = parsed.pack;
      }
    }
  } catch {
    // 静默降级意图：云端读取异常时内置包仍可微调（回退内置底稿）；云端包会因找不到底稿
    // 被 not_found 拦下，不会写坏数据
  }
  if (asset === undefined) return null;
  return { asset, version: parsePackIdVersion(asset.packId).version };
}

/** 微调草稿：当前资产 + 意图 → LLM → 闸门 → 服务端分类 */
export async function refineDomainPackDraft(
  body: unknown,
  authorization: string | null,
  deps: RefineServiceDeps,
): Promise<RefineDraftResult> {
  const input = normalizeRefineInput(body);
  if (input === null) return { status: "invalid" };

  const auth = await authorizeAdminRequest(authorization, deps.adminDeps ?? defaultAdminDeps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return { status: auth.status };

  const basePackId = parsePackIdVersion(input.packId).base;
  const current = await resolveCurrentAsset(deps.readClient ?? serverPrivilegedClient(), basePackId);
  if (current === null) return { status: "not_found" };

  // 元素微调（票 #85）：目标题目必须存在于当前资产（不信任前端传来的 templateId）
  if (
    input.targetTemplateId !== undefined &&
    !current.asset.templates.some((t) => t.templateId === input.targetTemplateId)
  ) {
    return { status: "invalid" };
  }

  if (deps.provider === undefined) {
    return { status: "llm_error", kind: "unknown", message: "LLM provider 未注入（未配置 DEEPSEEK_API_KEY？）" };
  }
  const prompt = buildRefinePrompt({
    packId: basePackId,
    intent: input.intent,
    sampleSql: input.sampleSql,
    currentPack: current.asset,
    targetTemplateId: input.targetTemplateId,
  });
  let completion: string;
  try {
    completion = await deps.provider.completeJson(prompt);
  } catch (err) {
    if (err instanceof LlmProviderError) {
      return { status: "llm_error", kind: err.kind, message: `${err.message}，可重试` };
    }
    return { status: "llm_error", kind: "unknown", message: `LLM 调用失败：${err instanceof Error ? err.message : String(err)}，可重试` };
  }

  let draft: unknown;
  try {
    draft = JSON.parse(completion) as unknown;
  } catch (err) {
    return { status: "llm_invalid_json", message: `LLM 输出不是合法 JSON：${err instanceof Error ? err.message : String(err)}` };
  }

  const report = await validateDomainPack(draft);
  const parsedDraft = parseDomainPackJson(draft);
  const changeClass = parsedDraft.ok ? classifyDomainPackChange(current.asset, parsedDraft.pack) : "B";
  return {
    status: "ok",
    draft,
    report,
    changeClass,
    currentVersionLabel: `v${current.version}`,
    // A 类即时生效（版本不变）；B 类确认后到达下一版本；闸门拒绝时分类仅供参考
    nextVersionLabel: changeClass === "B" ? `v${current.version + 1}` : `v${current.version}`,
  };
}

/**
 * 确认生效：服务端重过闸门 + 重判分类（不信任前端草稿），按 A/B 类落库。
 * 写入纪律：当前表 pack_id 恒为基础名（一行一域包）；B 类先写历史（旧版本完整资产、
 * pack_id 存该版本完整 id）再更新当前行——两步都走闸门通过后的同一写客户端。
 */
export async function applyDomainPackRefinement(
  body: unknown,
  authorization: string | null,
  deps: RefineServiceDeps = {},
): Promise<ApplyRefinementResult> {
  if (typeof body !== "object" || body === null) return { status: "invalid" };
  const { packId, pack } = body as { packId?: unknown; pack?: unknown };
  if (typeof packId !== "string" || packId.trim() === "" || typeof pack !== "object" || pack === null) {
    return { status: "invalid" };
  }

  const auth = await authorizeAdminRequest(authorization, deps.adminDeps ?? defaultAdminDeps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return { status: auth.status };

  try {
    const basePackId = parsePackIdVersion(packId).base;
    const current = await resolveCurrentAsset(deps.readClient ?? serverPrivilegedClient(), basePackId);
    if (current === null) return { status: "not_found" };

    // 契约不合法的草稿直接走闸门拒绝（结构检查即契约校验，报告可读）；不另行手拼报告
    const parsedDraft = parseDomainPackJson(pack);
    if (!parsedDraft.ok) {
      const report = await validateDomainPack(pack);
      return { status: "gate", report };
    }
    // 基础名不可改（ADR-0009）：草稿 packId 的基础名与目标不一致直接拒绝，不落库
    if (parsePackIdVersion(parsedDraft.pack.packId).base !== basePackId) {
      return { status: "base_name_changed", actualBasePackId: parsePackIdVersion(parsedDraft.pack.packId).base };
    }
    const changeClass = classifyDomainPackChange(current.asset, parsedDraft.pack);
    if (changeClass === "unchanged") return { status: "no_change" };

    // 引用形态草稿（LLM 回显引用数组等场景）过词表语义校验（#83）：拒绝不落库，防悬挂引用。
    // 既有引用取当前资产（已在内存）而非回查数据库——写入路径的「既有」即本次微调的底本。
    const vocab = deps.vocabSeam ?? {
      fetchKnowledgeAreaEntries: defaultVocabSeam().fetchKnowledgeAreaEntries,
      fetchCurrentRefIds: async () => current.asset.knowledgeAreaRefIds ?? null,
    };
    const vocabMessage = await checkKnowledgeAreaReferences(parsedDraft.pack, vocab);
    if (vocabMessage !== null) return { status: "vocabulary", message: vocabMessage };

    const writeClient = deps.writeClient ?? serverPrivilegedClient();
    if (changeClass === "A") {
      // A 类：packId 不变（沿用当前完整 id，含可能的版本后缀），直接更新当前行，不写历史
      const report = await validateDomainPack(parsedDraft.pack);
      if (!report.passed) return { status: "gate", report };
      const { error } = await writeClient.from("domain_pack_asset").upsert({
        pack_id: basePackId,
        asset: parsedDraft.pack,
      });
      if (error) return { status: "error", message: error.message };
      return { status: "ok", packId: parsedDraft.pack.packId, changeClass: "A", versionLabel: `v${current.version}` };
    }

    // B 类：产生新版本。服务端改写草稿 packId 为 基础名@vN（版本号不信任任何前端/LLM 输入）
    const nextVersion = current.version + 1;
    const newAsset = { ...parsedDraft.pack, packId: buildVersionedPackId(basePackId, nextVersion) };
    const report = await validateDomainPack(newAsset);
    if (!report.passed) return { status: "gate", report };
    // 旧版本先进历史（pack_id = 该版本完整 id：v1 即基础名，vN≥2 带 @vN），当前行随后更新
    const historyError = (await writeClient.from("domain_pack_version_history").upsert({
      pack_id: buildVersionedPackId(basePackId, current.version),
      version_label: `v${current.version}`,
      asset: current.asset,
    })).error;
    if (historyError) return { status: "error", message: historyError.message };
    const { error } = await writeClient.from("domain_pack_asset").upsert({
      pack_id: basePackId,
      asset: newAsset,
    });
    if (error) return { status: "error", message: error.message };
    return { status: "ok", packId: newAsset.packId, changeClass: "B", versionLabel: `v${nextVersion}` };
  } catch (err) {
    return { status: "error", message: `确认生效失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 版本历史查询：历史行 + 当前版本，按版本号倒序（新→旧），当前版本带 isCurrent 标记 */
export async function getDomainPackVersionHistory(
  packId: string,
  authorization: string | null,
  deps: RefineServiceDeps = {},
): Promise<VersionHistoryResult> {
  const auth = await authorizeAdminRequest(authorization, deps.adminDeps ?? defaultAdminDeps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return { status: auth.status };

  try {
    const basePackId = parsePackIdVersion(packId).base;
    const client = deps.readClient ?? serverPrivilegedClient();
    const entries: DomainPackVersionEntry[] = [];

    const current = await resolveCurrentAsset(client, basePackId);
    if (current !== null) {
      entries.push({
        packId: current.asset.packId,
        versionLabel: `v${current.version}`,
        name: current.asset.name,
        createdAt: null,
        isCurrent: true,
      });
    }

    try {
      const { data, error } = await client.from("domain_pack_version_history").select("pack_id, version_label, asset, created_at");
      if (!error && data !== null) {
        for (const row of data as { pack_id: string; version_label: string; asset: unknown; created_at?: string }[]) {
          // 按基础名过滤（行 pack_id 是带后缀完整 id 或 v1 基础名）；当前版本不重复列（历史表里
          // 恰有同版本行时以当前行口径为准）
          if (parsePackIdVersion(row.pack_id).base !== basePackId) continue;
          const parsed = parseDomainPackJson(row.asset);
          if (!parsed.ok) continue;
          if (parsed.pack.packId === current?.asset.packId) continue;
          entries.push({
            packId: parsed.pack.packId,
            versionLabel: row.version_label,
            name: parsed.pack.name,
            createdAt: row.created_at ?? null,
            isCurrent: false,
          });
        }
      }
    } catch {
      // 静默降级意图：历史表读取异常时只展示当前版本（历史区块不给错误页，教师可重进刷新）
    }

    entries.sort((a, b) => Number(b.versionLabel.slice(1)) - Number(a.versionLabel.slice(1)));
    return { status: "ok", versions: entries };
  } catch {
    return { status: "error" };
  }
}
