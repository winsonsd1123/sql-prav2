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
import { postAdminJson, getSessionAuth, readErrorMessage } from "@/lib/admin-api-client";
import {
  resolveGenerateOutcome,
  resolvePublishOutcome,
  validateGeneratorForm,
  type GenerateOutcome,
} from "@/components/domain-pack-generation-flow";
import { GateReportView } from "@/components/domain-pack-gate-report-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** 生成区块局部状态机：idle → generating → report/published；错误态可从任意请求后进入 */
type Phase =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "report"; outcome: GenerateOutcome & { phase: "report" } }
  | { kind: "publishing"; outcome: GenerateOutcome & { phase: "report" } }
  | { kind: "published"; packId: string };

/** 圈选器展示的词表条目（仅启用条目可圈选，ADR 0010） */
interface SelectableKnowledgeArea {
  id: string;
  name: string;
  description: string;
}

export default function AdminDomainPackGenerator({ onPublished, onDiscarded }: AdminDomainPackGeneratorProps) {
  const [description, setDescription] = useState("");
  const [sampleSql, setSampleSql] = useState("");
  const [tableCount, setTableCount] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  // 最近一次失败（生成或发布）：保留表单内容供重试；null = 无失败
  const [failure, setFailure] = useState<GenerateOutcome & { phase: "error" } | null>(null);
  // ── 圈选知识点（票 #82，可选步骤）：懒加载——教师展开圈选器才拉词表，不圈选走现状路径 ──
  const [vocabOpen, setVocabOpen] = useState(false);
  const [vocabEntries, setVocabEntries] = useState<SelectableKnowledgeArea[] | null>(null);
  const [vocabError, setVocabError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const busy = phase.kind === "generating" || phase.kind === "publishing";

  /** 展开圈选器：首次展开拉取词表启用条目（带会话 Bearer；失败不阻断生成，可不圈选继续） */
  const toggleVocab = async () => {
    const opening = !vocabOpen;
    setVocabOpen(opening);
    if (!opening || vocabEntries !== null || vocabError !== null) return;
    try {
      const { token } = await getSessionAuth();
      if (!token) throw new Error("no-session");
      const response = await fetch("/api/admin/knowledge-areas", { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "词表加载失败"));
      const body = (await response.json()) as { entries?: { id: string; name: string; description: string; active: boolean }[] };
      // 仅启用条目可圈选（停用条目不能再被新圈选，ADR 0010）
      setVocabEntries((body.entries ?? []).filter((entry) => entry.active).map(({ id, name, description }) => ({ id, name, description })));
      setVocabError(null);
    } catch {
      setVocabEntries([]);
      setVocabError("词表加载失败：可不圈选直接生成（自由产出），或稍后重试");
    }
  };

  /** 圈选/取消圈选一条知识点 */
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  };

  /** 发起生成：同步等待 LLM（约 1-3 分钟），期间禁用表单防重复提交 */
  const generate = async () => {
    const errors = validateGeneratorForm({ description, tableCount });
    setFormErrors(errors);
    if (errors.length > 0) return;
    setFailure(null);
    setPhase({ kind: "generating" });
    // 共享请求骨架（admin-api-client.postAdminJson）：无会话/网络失败的文案兜底与归类函数共用；
    // 未圈选不携带 knowledgeAreaIds 字段——请求载荷与现状零差异（票 #82 回归口径）
    const result = await postAdminJson("/api/admin/domain-packs/generate", {
      description,
      ...(sampleSql.trim() !== "" ? { sampleSql } : {}),
      ...(tableCount.trim() !== "" ? { tableCount: Number(tableCount) } : {}),
      ...(selectedIds.length > 0 ? { knowledgeAreaIds: selectedIds } : {}),
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
    <Card asChild className="rounded-2xl border-ink/10 p-5">
      <section data-testid="域包生成" aria-label="域包生成">
        <h2 className="标题 mb-1 text-lg">生成新域包</h2>
        <p className="mb-4 text-xs text-muted">
          用自然语言描述一个业务场景（如「图书馆：读者、图书、借阅记录」），由 AI 起草完整域包草稿，
          经机器验证闸门检查后由你确认发布。生成约需 1-3 分钟，请勿关闭页面。
        </p>

        {failure && (
          <div role="alert" className="mb-3 rounded-lg bg-fail/10 px-3 py-2 text-xs text-fail" data-testid="生成错误">
            <p>{failure.message}</p>
            {failure.needsKeyConfig && <p>生成服务尚未配置：请管理员在服务端设置 DEEPSEEK_API_KEY 后重试。</p>}
            {failure.retryable && (
              <Button onClick={retry} disabled={busy} size="xs" className="mt-2 px-3">
                重试
              </Button>
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
          {/* 圈选知识点（可选步骤，票 #82）：不圈选走现状路径（自由产出），圈选即封闭——
              服务端提示词注入圈选集合 + 闸门校验产出取自集合，双重强制 */}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="link"
              onClick={() => void toggleVocab()}
              disabled={busy}
              className="h-auto self-start p-0 text-xs font-normal text-muted underline-offset-2 hover:text-ink"
              data-testid="圈选知识点开关"
              aria-expanded={vocabOpen}
            >
              {vocabOpen ? "收起圈选知识点" : `圈选知识点（可选${selectedIds.length > 0 ? `，已圈选 ${selectedIds.length} 项` : ""}）`}
            </Button>
            {vocabOpen && (
              <div className="flex flex-col gap-1 rounded-lg border border-ink/10 p-3" data-testid="圈选知识点">
                <p className="text-xs text-muted">
                  勾选后本次生成的知识点清单只能取自圈选集合（越界草稿会被验证闸门拒绝）；不勾选则由 AI 自由拟定。
                </p>
                {vocabError && <p className="text-xs text-warn">{vocabError}</p>}
                {vocabEntries?.length === 0 && !vocabError && (
                  <p className="text-xs text-muted">词表暂无启用条目，可在「知识点词表」页维护后再来圈选。</p>
                )}
                {(vocabEntries ?? []).map((entry) => (
                  <label key={entry.id} className="flex items-start gap-2 text-sm" data-testid={`圈选项-${entry.name}`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(entry.id)}
                      onChange={() => toggleSelected(entry.id)}
                      disabled={busy}
                      className="mt-1"
                    />
                    <span>
                      {entry.name}
                      {entry.description.trim() !== "" && <span className="block text-xs text-muted">{entry.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {formErrors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-fail" data-testid="表单校验提示">
              {formErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={generate} disabled={busy} size="sm" className="px-4">
              {phase.kind === "generating" ? "正在生成，约需 1-3 分钟……" : "生成草稿"}
            </Button>
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
                  <p className="text-xs text-warn">草稿结构不完整，无法展示摘要；发布以服务端重校验为准。</p>
                )}
                <div className="flex items-center gap-3">
                  <Button onClick={publish} disabled={busy} size="sm" className="px-4">
                    {phase.kind === "publishing" ? "发布中……" : "确认发布"}
                  </Button>
                  <Button
                    onClick={() => {
                      setPhase({ kind: "idle" });
                      onDiscarded?.();
                    }}
                    disabled={busy}
                    variant="ghost"
                    size="sm"
                    className="px-3 font-normal text-muted hover:bg-transparent hover:text-ink"
                  >
                    放弃本次草稿
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase.kind === "published" && (
          <p role="status" className="mt-4 rounded-lg bg-pass/10 px-3 py-2 text-xs text-pass" data-testid="发布成功">
            已发布「{phase.packId}」，学生端刷新后即可见可练；可继续在下方放出清单管理其可见性。
          </p>
        )}
      </section>
    </Card>
  );
}
