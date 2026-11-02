"use client";

// 域包生成区块（票 #60 / spec #53 目标②，ADR-0008「教师端 LLM 起草 + 闸门 + 确认发布」）：
// 场景描述表单 → 同步等待（1-3 分钟，防重复提交）→ 验证报告（三段状态 + 逐条中文明细）
// → 通过则草稿摘要 + 确认发布 → 发布成功反馈；失败（502/503）给明确错误与重试（表单内容保留）。
// 状态转移决策全部走 domain-pack-generation-flow 纯函数，本组件只按 phase 渲染编排。
// 鉴权在 API 层（ADR-0007）；本组件经 admin-api-client 带 Bearer token。

import { useState } from "react";

/** 终态回调（页面注入）：发布成功（强制重拉云端清单，列表与放出管理即时纳入新包）
 * 与放弃草稿（票 #66：独立生成页借此回跳 /admin/packs；旧页暂不注入即维持原行为） */
export interface AdminDomainPackGeneratorProps {
  onPublished?: () => void;
  onDiscarded?: () => void;
}
import { postAdminJson } from "@/lib/admin-api-client";
import {
  resolveGenerateOutcome,
  resolvePublishOutcome,
  validateGeneratorForm,
  type GenerateOutcome,
} from "@/components/domain-pack-generation-flow";
import { GateReportView } from "@/components/domain-pack-gate-report-view";

/** 生成区块局部状态机：idle → generating → report/published；错误态可从任意请求后进入 */
type Phase =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "report"; outcome: GenerateOutcome & { phase: "report" } }
  | { kind: "publishing"; outcome: GenerateOutcome & { phase: "report" } }
  | { kind: "published"; packId: string };

export default function AdminDomainPackGenerator({ onPublished, onDiscarded }: AdminDomainPackGeneratorProps) {
  const [description, setDescription] = useState("");
  const [sampleSql, setSampleSql] = useState("");
  const [tableCount, setTableCount] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  // 最近一次失败（生成或发布）：保留表单内容供重试；null = 无失败
  const [failure, setFailure] = useState<GenerateOutcome & { phase: "error" } | null>(null);

  const busy = phase.kind === "generating" || phase.kind === "publishing";

  /** 发起生成：同步等待 LLM（约 1-3 分钟），期间禁用表单防重复提交 */
  const generate = async () => {
    const errors = validateGeneratorForm({ description, tableCount });
    setFormErrors(errors);
    if (errors.length > 0) return;
    setFailure(null);
    setPhase({ kind: "generating" });
    // 共享请求骨架（admin-api-client.postAdminJson）：无会话/网络失败的文案兜底与归类函数共用
    const result = await postAdminJson("/api/admin/domain-packs/generate", {
      description,
      ...(sampleSql.trim() !== "" ? { sampleSql } : {}),
      ...(tableCount.trim() !== "" ? { tableCount: Number(tableCount) } : {}),
    });
    if (!result.ok) {
      setFailure({ phase: "error", message: "登录态已失效，请重新登录", retryable: true, needsKeyConfig: false });
      setPhase({ kind: "idle" });
      return;
    }
    const outcome = resolveGenerateOutcome(result.status, result.body);
    if (outcome.phase === "error") {
      setFailure(outcome);
      setPhase({ kind: "idle" });
    } else {
      setPhase({ kind: "report", outcome });
    }
  };

  /** 确认发布：服务端会重过闸门（不信任前端草稿），422 时回到报告态展示新报告 */
  const publish = async () => {
    if (phase.kind !== "report") return;
    setFailure(null);
    setPhase({ kind: "publishing", outcome: phase.outcome });
    const result = await postAdminJson("/api/admin/domain-packs/publish", { pack: phase.outcome.draft });
    if (!result.ok) {
      setFailure({ phase: "error", message: "登录态已失效，请重新登录", retryable: true, needsKeyConfig: false });
      setPhase({ kind: "report", outcome: phase.outcome });
      return;
    }
    const outcome = resolvePublishOutcome(result.status, result.body);
    if (outcome.phase === "published") {
      setPhase({ kind: "published", packId: outcome.packId });
      onPublished?.();
    } else if (outcome.phase === "gate-rejected") {
      setPhase({ kind: "report", outcome: { phase: "report", draft: phase.outcome.draft, report: outcome.report, summary: phase.outcome.summary } });
    } else {
      setFailure(outcome);
      setPhase({ kind: "report", outcome: phase.outcome });
    }
  };

  /** 重试 = 用保留的表单内容重新发起生成（错误态不清表单） */
  const retry = () => void generate();

  return (
    <section
      data-testid="域包生成"
      aria-label="域包生成"
      className="卡片 rounded-2xl border border-ink/10 bg-paper p-5"
    >
      <h2 className="标题 mb-1 text-lg">生成新域包</h2>
      <p className="mb-4 text-xs text-muted">
        用自然语言描述一个业务场景（如「图书馆：读者、图书、借阅记录」），由 AI 起草完整域包草稿，
        经机器验证闸门检查后由你确认发布。生成约需 1-3 分钟，请勿关闭页面。
      </p>

      {failure && (
        <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="生成错误">
          <p>{failure.message}</p>
          {failure.needsKeyConfig && <p>生成服务尚未配置：请管理员在服务端设置 DEEPSEEK_API_KEY 后重试。</p>}
          {failure.retryable && (
            <button onClick={retry} disabled={busy} className="主按钮 mt-2 px-3 py-1 text-xs disabled:opacity-50">
              重试
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          场景描述
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="例：图书馆借阅场景：读者、图书、借阅记录，读者可借多本书……"
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm disabled:opacity-50"
            data-testid="场景描述"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          难度 SQL 样例（可选）
          <textarea
            value={sampleSql}
            onChange={(e) => setSampleSql(e.target.value)}
            disabled={busy}
            rows={2}
            placeholder="例：SELECT 读者姓名, COUNT(*) FROM 借阅记录 GROUP BY 1 ORDER BY 2 DESC"
            className="rounded-lg border border-ink/20 px-3 py-2 font-mono text-xs disabled:opacity-50"
            data-testid="难度样例"
          />
        </label>
        <label className="flex w-48 flex-col gap-1 text-sm">
          表数意愿（3-5，可选）
          <input
            value={tableCount}
            onChange={(e) => setTableCount(e.target.value)}
            disabled={busy}
            inputMode="numeric"
            placeholder="如 3"
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm disabled:opacity-50"
            data-testid="表数意愿"
          />
        </label>
        {formErrors.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-red-700" data-testid="表单校验提示">
            {formErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-3">
          <button onClick={generate} disabled={busy} className="主按钮 px-4 py-1.5 text-xs disabled:opacity-50">
            {phase.kind === "generating" ? "正在生成，约需 1-3 分钟……" : "生成草稿"}
          </button>
          {phase.kind === "generating" && (
            <span className="text-xs text-muted" data-testid="生成等待提示">
              正在生成，约需 1-3 分钟，请勿重复提交
            </span>
          )}
        </div>
      </div>

      {(phase.kind === "report" || phase.kind === "publishing") && (
        <div className="mt-4 flex flex-col gap-3 border-t border-ink/10 pt-4" data-testid="生成结果">
          <GateReportView report={phase.outcome.report} />
          {phase.outcome.report.passed && (
            <div className="flex flex-col gap-2">
              {phase.outcome.summary ? (
                <p className="text-xs text-muted" data-testid="草稿摘要">
                  即将发布：{phase.outcome.summary.name}（{phase.outcome.summary.packId}）——
                  {phase.outcome.summary.tableCount} 张表、{phase.outcome.summary.templateCount} 道模板，
                  难度分布{" "}
                  {(["1", "2", "3", "4", "5"] as const)
                    .map((t) => `档${t}×${phase.outcome.summary?.tierCounts[t] ?? 0}`)
                    .join(" / ")}
                </p>
              ) : (
                // 静默降级边界：闸门通过但草稿摘要字段缺失（理论上不该发生）——只提示，不阻断发布
                <p className="text-xs text-amber-700">草稿结构不完整，无法展示摘要；发布以服务端重校验为准。</p>
              )}
              <div className="flex items-center gap-3">
                <button onClick={publish} disabled={busy} className="主按钮 px-4 py-1.5 text-xs disabled:opacity-50">
                  {phase.kind === "publishing" ? "发布中……" : "确认发布"}
                </button>
                <button
                  onClick={() => {
                    setPhase({ kind: "idle" });
                    onDiscarded?.();
                  }}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-ink disabled:opacity-50"
                >
                  放弃本次草稿
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase.kind === "published" && (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700" data-testid="发布成功">
          已发布「{phase.packId}」，学生端刷新后即可见可练；可继续在下方放出清单管理其可见性。
        </p>
      )}
    </section>
  );
}
