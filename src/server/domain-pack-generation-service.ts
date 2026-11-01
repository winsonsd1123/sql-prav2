// 域包生成/发布编排服务（票 #59 / spec #53 目标②，ADR-0008/0007）：
// 生成 = 提示词组装（契约全文嵌入）→ LLM provider（薄抽象，测试注入 fake）→ JSON 解析
//   → #56 验证闸门 → 同步返回 {草稿, GateReport}（闸门拒绝时草稿与报告都返回，供教师修改后重试）；
// 发布 = 服务端重过闸门（不信任前端）→ 复用 #57 upsertDomainPackAsset 落库（首次发布即版本 1，
//   版本历史为 #62 范围；domain_pack_asset 当前最新版即内容本身）。
// 鉴权在服务层收口：authorizeAdminRequest 双权限点（「访问后台」+「域包管理」，ADR-0005/0007）。
// LLM/网络失败返回结构化错误（可重试），不静默降级。

import { authorizeAdminRequest, defaultAdminDeps, type AdminDeps } from "@/server/admin-service";
import { PERMISSIONS } from "@/lib/permissions";
import { buildDomainPackPrompt, type DomainPackGenerationInput } from "@/server/domain-pack-prompt";
import type { LlmProvider } from "@/server/llm-provider";
import { LlmProviderError } from "@/server/llm-provider";
import { validateDomainPack, type GateReport } from "@/kernel/domain-pack-gate";
import { upsertDomainPackAsset, type DomainPackWriteClient } from "@/server/domain-pack-asset-service";
import { serverPrivilegedClient } from "@/lib/supabase/server-client";

/** 可注入依赖（测试接缝）：LLM provider / 鉴权链 / 云端写客户端 */
export interface GenerationServiceDeps {
  provider: LlmProvider;
  adminDeps?: AdminDeps;
  writeClient?: DomainPackWriteClient;
}

/** 发布依赖：不需要 LLM（重过闸门 + 落库） */
export type PublishServiceDeps = Omit<GenerationServiceDeps, "provider">;

export type GenerateDraftResult =
  | { status: "ok"; draft: unknown; report: GateReport }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | { status: "llm_error"; kind: "network" | "api" | "empty" | "unknown"; message: string }
  | { status: "llm_invalid_json"; message: string };

export type PublishResult =
  | { status: "ok"; packId: string }
  | { status: "gate"; report: GateReport }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | { status: "error"; message: string };

/** 入参形状校验：描述必填非空字符串；表数意愿若给出须是 3-5 的整数 */
function normalizeGenerationInput(body: unknown): DomainPackGenerationInput | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as { description?: unknown; sampleSql?: unknown; tableCount?: unknown };
  if (typeof raw.description !== "string" || raw.description.trim() === "") return null;
  if (raw.sampleSql !== undefined && typeof raw.sampleSql !== "string") return null;
  if (raw.tableCount !== undefined && (typeof raw.tableCount !== "number" || !Number.isInteger(raw.tableCount) || raw.tableCount < 3 || raw.tableCount > 5)) {
    return null;
  }
  return { description: raw.description, sampleSql: raw.sampleSql, tableCount: raw.tableCount };
}

/**
 * 生成域包草稿：教师描述 → LLM 起草 → 闸门验证 → 草稿与报告同步返回。
 * 闸门拒绝不算生成失败（status 仍为 ok，report.passed=false）——教师端据报告修改描述后重试；
 * 只有 LLM 调用与 JSON 解析失败才返回错误分类（前端给重试入口）。
 */
export async function generateDomainPackDraft(
  body: unknown,
  authorization: string | null,
  deps: GenerationServiceDeps,
): Promise<GenerateDraftResult> {
  const input = normalizeGenerationInput(body);
  if (input === null) return { status: "invalid" };

  const auth = await authorizeAdminRequest(authorization, deps.adminDeps ?? defaultAdminDeps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return { status: auth.status };

  const prompt = buildDomainPackPrompt(input);
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
  return { status: "ok", draft, report };
}

/**
 * 确认发布：服务端重过闸门（不信任前端草稿）→ 复用 #57 写入路径落库。
 * 首次发布即版本 1（domain_pack_asset 无版本列，pack_id 基础名即当前最新版本，#62 落版本历史）。
 */
export async function publishDomainPack(
  body: unknown,
  authorization: string | null,
  deps: PublishServiceDeps = {},
): Promise<PublishResult> {
  if (typeof body !== "object" || body === null || typeof (body as { pack?: unknown }).pack !== "object" || (body as { pack?: unknown }).pack === null) {
    return { status: "invalid" };
  }
  const auth = await authorizeAdminRequest(authorization, deps.adminDeps ?? defaultAdminDeps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return { status: auth.status };

  const result = await upsertDomainPackAsset(deps.writeClient ?? serverPrivilegedClient(), (body as { pack: unknown }).pack);
  if (result.ok) return { status: "ok", packId: result.packId };
  if (result.kind === "gate") return { status: "gate", report: result.report };
  return { status: "error", message: result.message };
}
