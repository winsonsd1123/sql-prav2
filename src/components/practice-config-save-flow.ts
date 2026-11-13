// 演练配置保存流程纯函数（票 #115）：PUT /api/admin/domain-packs/practice-config 的
// 失败响应归类在此收口为逐条 toast 文案清单，组件 save() 不散落分支。
// 契约见路由：200 | 400 { error | errors } | 404 { error } | 422 { ok:false, report }（闸门拒绝，与发布路由同口径）。

import { formatGateIssueLines, type GateReport } from "@/kernel/domain-pack-gate";
import { errorMessageFromBody } from "@/lib/admin-api-client";

/**
 * 归类保存失败响应（已解析 body）为 toast 文案清单：
 * 闸门 report 各段问题 → 首条闸门语境 + 逐条可读中文（票 #115：此前只剩兜底文案，教师不知道拒了什么）；
 * 400 契约错误清单（errors 数组）逐条原样透出；其余走 error 字符串/兜底。
 */
export function resolvePracticeConfigSaveMessages(body: unknown): string[] {
  if (typeof body === "object" && body !== null) {
    const report = (body as { report?: GateReport }).report;
    if (report !== undefined) {
      const issues = formatGateIssueLines(report);
      if (issues.length > 0) return ["保存被验证闸门拒绝", ...issues];
    }
    const errors = (body as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.every((e): e is string => typeof e === "string") && errors.length > 0) {
      return errors;
    }
  }
  return [errorMessageFromBody(body, "演练配置保存失败")];
}
