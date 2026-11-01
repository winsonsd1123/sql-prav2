// 域包微调流程状态转移纯函数（票 #62 / ADR-0009）：发起微调与确认生效两步请求的
// 响应归类、表单校验收口为纯函数，组件层按 phase 渲染（沿用 #60 生成流的拆分先例）。
// 与生成流同槽的错误语义：502/503 可重试（表单保留）；404/409 不可重试（提示后修正输入）。

import { buildDraftSummary, type DomainPackDraftSummary } from "@/components/domain-pack-admin-view-model";
import type { GateReport } from "@/kernel/domain-pack-gate";
import type { DomainPackChangeClass } from "@/kernel/domain-pack-versioning";

/** 微调表单输入（字符串态便于受控输入） */
export interface RefineFormInput {
  /** 目标域包基础名（选择器） */
  packId: string;
  /** 修改意图（必填） */
  intent: string;
}

/** 表单校验：与路由层预检同口径 */
export function validateRefineForm(input: RefineFormInput): string[] {
  const errors: string[] = [];
  if (input.packId.trim() === "") errors.push("请先选择要微调的域包");
  if (input.intent.trim() === "") errors.push("修改意图不能为空");
  return errors;
}

/** 微调请求返回后的阶段：报告态（闸门通过与否都展示报告 + A/B 类提示）或错误态 */
export type RefineOutcome =
  | {
      phase: "report";
      draft: unknown;
      report: GateReport;
      /** 服务端 diff 判定的改动分类 */
      changeClass: DomainPackChangeClass;
      currentVersionLabel: string;
      /** 确认生效将到达的版本号（A 类 = 当前版本，B 类 = 新版本） */
      nextVersionLabel: string;
      /** 草稿摘要；结构不完整时为 null */
      summary: DomainPackDraftSummary | null;
    }
  | { phase: "error"; message: string; retryable: boolean; needsKeyConfig: boolean };

/** 归类微调响应：status/异常 body 兜底通用文案（网络失败同属可重试，不静默） */
export function resolveRefineOutcome(status: number, body: unknown): RefineOutcome {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { draft, report, changeClass, currentVersionLabel, nextVersionLabel } = body as {
      draft?: unknown;
      report?: GateReport;
      changeClass?: DomainPackChangeClass;
      currentVersionLabel?: string;
      nextVersionLabel?: string;
    };
    if (report !== undefined && changeClass !== undefined) {
      return {
        phase: "report",
        draft,
        report,
        changeClass,
        currentVersionLabel: currentVersionLabel ?? "v1",
        nextVersionLabel: nextVersionLabel ?? "v1",
        summary: buildDraftSummary(draft),
      };
    }
  }
  const message =
    typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "微调请求失败，请稍后重试";
  return {
    phase: "error",
    message,
    retryable: status !== 404,
    needsKeyConfig: (body as { code?: unknown } | null)?.code === "llm_not_configured",
  };
}

/** 生效请求返回后的阶段 */
export type ApplyRefineOutcome =
  | { phase: "applied"; packId: string; changeClass: "A" | "B"; versionLabel: string }
  | { phase: "gate-rejected"; report: GateReport }
  | { phase: "error"; message: string; retryable: boolean };

/** 归类生效响应：422 = 服务端重过闸门拒绝回报告态；409 = 基础名被改/无差异（不可重试） */
export function resolveApplyOutcome(status: number, body: unknown): ApplyRefineOutcome {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { packId, changeClass, versionLabel } = body as { packId?: string; changeClass?: "A" | "B"; versionLabel?: string };
    if (typeof packId === "string" && (changeClass === "A" || changeClass === "B")) {
      return { phase: "applied", packId, changeClass, versionLabel: versionLabel ?? "" };
    }
  }
  if (status === 422 && typeof body === "object" && body !== null) {
    const report = (body as { report?: GateReport }).report;
    if (report !== undefined) return { phase: "gate-rejected", report };
  }
  const message =
    typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "确认生效失败，请稍后重试";
  return { phase: "error", message, retryable: status !== 409 };
}
