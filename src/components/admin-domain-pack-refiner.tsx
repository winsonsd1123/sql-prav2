"use client";

// 域包微调区块（票 #62 / spec #53 目标②，ADR-0009「微调与新建共用同一闸门与确认流」）：
// 选择域包 → 修改意图（可附 SQL 样例）→ 同步等待 LLM（防重复提交）→ 验证报告 + A/B 类
// 改动提示（明示后果：A 类即时生效、packId 不变；B 类将产生新版本、进行中会话钉旧版本）
// → 确认生效 → 成功反馈。状态转移走 domain-pack-refine-flow 纯函数，本组件只按 phase 渲染。
// 跨页入口经 targetBasePackId 预选目标（票 #67：?packId= 查询参数契约；旧单页滚动定位
// 机制由 #70 废除）。预选值须落在展示清单内：云端清单异步加载完成前选项未含目标包，
// 预选在清单就绪后生效；参数无效（不在清单中）回退页内选择器兜底。
// 鉴权在 API 层（ADR-0007）；经 admin-api-client 带 Bearer token。

import { useState } from "react";
import { postAdminJson } from "@/lib/admin-api-client";
import { GateReportView } from "@/components/domain-pack-gate-report-view";
import {
  validateRefineForm,
  resolveRefineOutcome,
  resolveApplyOutcome,
  type RefineOutcome,
} from "@/components/domain-pack-refine-flow";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";
import { describeElementTarget, toRequestTarget, type ElementRefineTarget } from "@/components/element-refine-target";
import type { DomainPack } from "@/kernel/types";

export interface AdminDomainPackRefinerProps {
  /** 展示清单（页面收敛：每基础名一行最新版）；选择器的选项基础名派生 */
  packs: readonly DomainPack[];
  /** 跨页入口预选的基础名（null = 未指定；不在展示清单中视为无效，回退页内选择器） */
  targetBasePackId: string | null;
  /** 生效成功回调（页面注入：强制重拉云端清单，列表即时反映新版本） */
  onApplied?: () => void;
  /** 元素微调目标（票 #85 单题 → #87 三类元素统一）：给定时锁定为该包的元素微调
   * （请求体按目标类别携带 targetTemplateId / targetTemplateIds / targetTable /
   * targetKnowledgeArea，服务端写进提示词做元素定位），隐藏包选择器并显示目标徽标 */
  target?: ElementRefineTarget | null;
  /** 取消元素微调目标（详情页注入：清除选中态回到纯只读） */
  onClearTarget?: () => void;
}

/** 微调区块局部状态机：idle → refining → report/applying → applied；错误态保留表单供重试 */
type Phase =
  | { kind: "idle" }
  | { kind: "refining" }
  | { kind: "report"; outcome: RefineOutcome & { phase: "report" } }
  | { kind: "applying"; outcome: RefineOutcome & { phase: "report" } }
  | { kind: "applied"; packId: string; changeClass: "A" | "B"; versionLabel: string };

/** A/B 类改动后果提示（GLOSSARY「域包版本」，与 ADR-0009 口径一致） */
function changeClassHint(outcome: RefineOutcome & { phase: "report" }): string {
  if (outcome.changeClass === "B") {
    return `B 类改动：确认后将产生新版本（${outcome.nextVersionLabel}，packId 带版本后缀），旧版本保留供进行中会话加载；新会话使用最新版本。`;
  }
  if (outcome.changeClass === "A") {
    return `A 类改动：确认后即时生效（packId 不变，不产生新版本）。`;
  }
  return "草稿与当前域包没有差异。";
}

export default function AdminDomainPackRefiner({
  packs,
  targetBasePackId,
  onApplied,
  target,
  onClearTarget,
}: AdminDomainPackRefinerProps) {
  const options = packs.map((d) => {
    const { base } = parsePackIdVersion(d.packId);
    return { base, name: d.name };
  });
  // 跨页入口预选：页面以 key={targetBasePackId} 挂载本组件，入口切换即重挂载回到预选值。
  // 预选派生而非初始 state——云端清单异步就绪前选项未含目标包，就绪后预选随之生效；
  // 用户手动选择后以手选值为准（含选回占位项），预选不再抢夺。
  const [userSelected, setUserSelected] = useState<string | null>(null);
  const preselected = targetBasePackId !== null && options.some((o) => o.base === targetBasePackId) ? targetBasePackId : null;
  const selectedBase = userSelected ?? preselected ?? "";
  const [intent, setIntent] = useState("");
  const [sampleSql, setSampleSql] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState<RefineOutcome & { phase: "error" } | null>(null);

  const busy = phase.kind === "refining" || phase.kind === "applying";

  /** 发起微调：同步等待 LLM（约 1-3 分钟），期间禁用表单防重复提交 */
  const refine = async () => {
    const errors = validateRefineForm({ packId: selectedBase, intent });
    setFormErrors(errors);
    if (errors.length > 0) return;
    setFailure(null);
    setPhase({ kind: "refining" });
    // 共享请求骨架（admin-api-client.postAdminJson）：与生成区块同款，无会话/网络失败统一兜底
    const result = await postAdminJson("/api/admin/domain-packs/refine", {
      packId: selectedBase,
      intent,
      ...(sampleSql.trim() !== "" ? { sampleSql } : {}),
      // 元素微调（#85 单题 → #87 三类元素）：目标随请求体进入服务端提示词（元素定位约束在服务端拼装）
      ...(target != null ? toRequestTarget(target) : {}),
    });
    if (!result.ok) {
      setFailure({ phase: "error", message: "登录态已失效，请重新登录", retryable: true, needsKeyConfig: false });
      setPhase({ kind: "idle" });
      return;
    }
    const outcome = resolveRefineOutcome(result.status, result.body);
    if (outcome.phase === "error") {
      setFailure(outcome);
      setPhase({ kind: "idle" });
    } else {
      setPhase({ kind: "report", outcome });
    }
  };

  /** 确认生效：服务端重过闸门 + 重判分类（A 类即时生效 / B 类产生新版本） */
  const apply = async () => {
    if (phase.kind !== "report") return;
    setPhase({ kind: "applying", outcome: phase.outcome });
    const result = await postAdminJson("/api/admin/domain-packs/refine/apply", {
      packId: selectedBase,
      pack: phase.outcome.draft,
    });
    if (!result.ok) {
      setFailure({ phase: "error", message: "登录态已失效，请重新登录", retryable: true, needsKeyConfig: false });
      setPhase({ kind: "idle" });
      return;
    }
    const outcome = resolveApplyOutcome(result.status, result.body);
    if (outcome.phase === "applied") {
      setPhase({ kind: "applied", packId: outcome.packId, changeClass: outcome.changeClass, versionLabel: outcome.versionLabel });
      onApplied?.();
    } else if (outcome.phase === "gate-rejected") {
      // 服务端闸门拒绝：报告已更新，回报告态供教师放弃或改意图重试
      setPhase({ kind: "report", outcome: { ...phase.outcome, report: outcome.report } });
    } else {
      setFailure({ phase: "error", message: outcome.message, retryable: outcome.retryable, needsKeyConfig: false });
      setPhase({ kind: "report", outcome: phase.outcome });
    }
  };

  const reset = () => {
    setPhase({ kind: "idle" });
    setFailure(null);
    setIntent("");
    setSampleSql("");
  };

  return (
    <section
      data-testid="域包微调"
      aria-label="域包微调"
      className="卡片 rounded-2xl border border-ink/10 bg-paper p-5"
    >
      <h2 className="标题 mb-1 text-lg">域包微调</h2>
      <p className="mb-4 text-xs text-muted">
        选择域包并描述修改意图，AI 产出修改后草稿；改动分类由系统判定——A 类（难度档位定义/演练配置）即时生效，
        B 类（库骨架/名称池/题目模板/知识点清单）产生新版本，进行中会话留在旧版本。
      </p>
      {target != null ? (
        // 元素微调（#85 单题 → #87 三类元素）：目标由详情页选中而来，锁定目标包（隐藏选择器防漂移）
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm"
          data-testid="元素微调目标"
        >
          <span>
            元素微调目标：<span className="font-mono">{describeElementTarget(target)}</span>
            <span className="ml-1 text-xs text-muted">（只修改选中的元素，其余逐字保留）</span>
          </span>
          {onClearTarget && (
            <button
              type="button"
              className="次按钮 ml-auto px-2 py-0.5 text-xs"
              data-testid="取消元素微调目标"
              onClick={onClearTarget}
              disabled={busy}
            >
              取消选中
            </button>
          )}
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        {target == null && (
        <label className="flex flex-col gap-1 text-sm">
          目标域包
          <select
            data-testid="微调目标域包"
            className="rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
            value={selectedBase}
            onChange={(e) => setUserSelected(e.target.value)}
            disabled={busy}
          >
            <option value="">请选择域包</option>
            {options.map((o) => (
              <option key={o.base} value={o.base}>
                {o.name}（{o.base}）
              </option>
            ))}
          </select>
        </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          修改意图
          <textarea
            data-testid="修改意图"
            className="min-h-20 rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
            placeholder="如：把题目模板的提示写得更具体；给难度档位定义补充样例 SQL"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          参考难度 SQL 样例（可选）
          <textarea
            data-testid="微调SQL样例"
            className="min-h-16 rounded-lg border border-ink/15 px-2 py-1.5 font-mono text-xs"
            placeholder="SELECT 姓名, COUNT(*) FROM 成绩 JOIN 学生 …"
            value={sampleSql}
            onChange={(e) => setSampleSql(e.target.value)}
            disabled={busy}
          />
        </label>
        {formErrors.length > 0 && (
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-fail" data-testid="微调表单错误">
            {formErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {failure !== null && (
          <p className="text-xs text-fail" data-testid="微调失败提示">
            {failure.message}
            {failure.needsKeyConfig && "（需在服务端配置 DEEPSEEK_API_KEY）"}
          </p>
        )}
        {phase.kind === "refining" && (
          <p className="text-sm text-muted" data-testid="微调等待提示">
            正在生成修改草稿（约 1-3 分钟，请勿重复提交）……
          </p>
        )}
        {phase.kind === "report" || phase.kind === "applying" ? (
          <div className="flex flex-col gap-3" data-testid="微调报告">
            <p className="text-sm text-muted" data-testid="改动分类提示">
              {changeClassHint(phase.outcome)}
            </p>
            <GateReportView report={phase.outcome.report} />
            {phase.outcome.report.passed && phase.outcome.changeClass !== "unchanged" && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="主按钮 px-3 py-1.5 text-sm"
                  data-testid="确认生效"
                  onClick={apply}
                  disabled={phase.kind === "applying"}
                >
                  {phase.kind === "applying" ? "正在生效……" : "确认生效"}
                </button>
                <button type="button" className="次按钮 px-3 py-1.5 text-sm" onClick={reset} disabled={phase.kind === "applying"}>
                  放弃
                </button>
              </div>
            )}
          </div>
        ) : null}
        {phase.kind === "applied" && (
          <div className="flex flex-col gap-2" data-testid="微调生效反馈">
            <p className="text-sm font-medium text-pass">
              已生效（{phase.changeClass} 类改动，版本 {phase.versionLabel}）
            </p>
            <p className="font-mono text-xs text-muted">
              {phase.changeClass === "B"
                ? `新版本 packId：${phase.packId}（旧会话仍加载旧版本，新会话使用此版本）`
                : `packId 不变：${phase.packId}（即时生效）`}
            </p>
            <button type="button" className="次按钮 w-fit px-3 py-1.5 text-sm" onClick={reset}>
              再微调一轮
            </button>
          </div>
        )}
        {(phase.kind === "idle" || phase.kind === "applied") && (
          <button
            type="button"
            className="主按钮 w-fit px-3 py-1.5 text-sm"
            data-testid="发起微调"
            onClick={refine}
            disabled={busy}
          >
            发起微调
          </button>
        )}
      </div>
    </section>
  );
}
