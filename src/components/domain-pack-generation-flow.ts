// 域包生成流程状态转移纯函数（票 #60 / spec #53 目标②，ADR-0008「同步等待 + 失败给重试入口」）：
// 生成（POST /api/admin/domain-packs/generate，同步 1-3 分钟）与发布（POST .../publish）
// 的响应归类、表单校验在此收口为纯函数；组件层按 phase 渲染，不散落分支。
// 契约见 #59 路由：generate → 200 {draft, report} | 502 {code, error, retryable} | 503 {code: llm_not_configured}；
// publish → 200 {ok, packId} | 422 {ok:false, report}。

import { buildDraftSummary, type DomainPackDraftSummary } from "@/components/domain-pack-admin-view-model";
import { errorMessageFromBody } from "@/lib/admin-api-client";
import type { GateReport } from "@/kernel/domain-pack-gate";

/** 生成表单输入（字符串态便于受控输入） */
export interface GeneratorFormInput {
  description: string;
  /** 可选难度 SQL 样例（textarea，无校验约束） */
  sampleSql?: string;
  /** 表数意愿 3-5；空串 = 未指定 */
  tableCount?: string;
}

/** 表单校验：与 #59 服务层入参校验同口径（描述非空、表数 3-5 整数或空） */
export function validateGeneratorForm(input: GeneratorFormInput): string[] {
  const errors: string[] = [];
  if (input.description.trim() === "") errors.push("场景描述不能为空");
  const raw = input.tableCount?.trim() ?? "";
  if (raw !== "") {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 3 || value > 5) errors.push("表数意愿必须是 3-5 的整数");
  }
  return errors;
}

/** 生成请求返回后的阶段：报告态（闸门通过与否都在此态展示报告）或错误态（可重试） */
export type GenerateOutcome =
  | {
      phase: "report";
      draft: unknown;
      report: GateReport;
      /** 草稿摘要；结构不完整时为 null（界面提示无法摘要，发布按钮仍以 report.passed 为准） */
      summary: DomainPackDraftSummary | null;
    }
  | {
      phase: "error";
      message: string;
      retryable: boolean;
      /** 503 专用：提示教师需在服务端配置 DEEPSEEK_API_KEY */
      needsKeyConfig: boolean;
    };

/** 归类生成响应：status=0/异常 body 兜底通用文案（网络失败同属可重试，不静默） */
export function resolveGenerateOutcome(status: number, body: unknown): GenerateOutcome {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { draft, report } = body as { draft?: unknown; report?: GateReport };
    if (report !== undefined) {
      return { phase: "report", draft, report, summary: buildDraftSummary(draft) };
    }
  }
  return {
    phase: "error",
    message: errorMessageFromBody(body, "生成请求失败，请稍后重试"),
    retryable: true,
    needsKeyConfig: (body as { code?: unknown } | null)?.code === "llm_not_configured",
  };
}

/** 发布请求返回后的阶段 */
export type PublishOutcome =
  | { phase: "published"; packId: string }
  | { phase: "gate-rejected"; report: GateReport }
  | { phase: "error"; message: string; retryable: boolean; needsKeyConfig: false };

/** 归类发布响应：422 = 服务端重过闸门拒绝（不信任前端草稿），报告完整透传回报告态 */
export function resolvePublishOutcome(status: number, body: unknown): PublishOutcome {
  if (status === 200 && typeof body === "object" && body !== null) {
    const packId = (body as { packId?: unknown }).packId;
    if (typeof packId === "string") return { phase: "published", packId };
  }
  if (status === 422 && typeof body === "object" && body !== null) {
    const report = (body as { report?: GateReport }).report;
    if (report !== undefined) return { phase: "gate-rejected", report };
  }
  return {
    phase: "error",
    message: errorMessageFromBody(body, "发布失败，请稍后重试"),
    retryable: true,
    needsKeyConfig: false,
  };
}
