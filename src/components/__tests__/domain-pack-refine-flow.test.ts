// 接缝：微调流程状态转移纯函数（票 #62）——表单校验、微调/生效响应归类。
// 契约见路由：refine → 200 {draft, report, changeClass, currentVersionLabel, nextVersionLabel}
//   | 404 | 502/503 {code, error, retryable}；apply → 200 {ok, packId, changeClass, versionLabel}
//   | 409 {code: base_name_changed|no_change} | 422 {ok:false, report}。
import { describe, expect, it } from "vitest";
import {
  validateRefineForm,
  resolveRefineOutcome,
  resolveApplyOutcome,
} from "@/components/domain-pack-refine-flow";
import type { GateReport } from "@/kernel/domain-pack-gate";

const passedReport: GateReport = {
  passed: true,
  structural: { status: "通过", issues: [], checkedTables: 3, checkedTemplates: 28 },
  generation: { status: "通过", issues: [], seeds: [20260101] },
  selfJudging: { status: "通过", issues: [], checkedTemplates: 28, seed: 20260101 },
};

describe("validateRefineForm：微调表单校验", () => {
  it("目标域包与修改意图必填", () => {
    expect(validateRefineForm({ packId: "", intent: "改" })).toEqual(["请先选择要微调的域包"]);
    expect(validateRefineForm({ packId: "x", intent: "  " })).toEqual(["修改意图不能为空"]);
    expect(validateRefineForm({ packId: "x", intent: "改" })).toEqual([]);
  });
});

describe("resolveRefineOutcome：微调响应归类", () => {
  it("200 → 报告态：携带分类与版本预告 + 草稿摘要", () => {
    const outcome = resolveRefineOutcome(200, {
      draft: { packId: "x", name: "X", schemaSkeleton: [{}, {}, {}], templates: Array.from({ length: 28 }, (_, i) => ({ difficulty: (i % 5) + 1 })) },
      report: passedReport,
      changeClass: "B",
      currentVersionLabel: "v1",
      nextVersionLabel: "v2",
    });
    expect(outcome.phase).toBe("report");
    if (outcome.phase !== "report") throw new Error("unreachable");
    expect(outcome.changeClass).toBe("B");
    expect(outcome.nextVersionLabel).toBe("v2");
    expect(outcome.summary).not.toBeNull();
  });

  it("404 → 错误态（不可重试：目标域包不存在）", () => {
    const outcome = resolveRefineOutcome(404, { error: "目标域包不存在" });
    expect(outcome.phase).toBe("error");
    if (outcome.phase !== "error") throw new Error("unreachable");
    expect(outcome.retryable).toBe(false);
  });

  it("502/503 → 可重试错误态；503 标记需配置 DEEPSEEK_API_KEY", () => {
    expect((resolveRefineOutcome(502, { error: "x" }) as { retryable: boolean }).retryable).toBe(true);
    const outcome = resolveRefineOutcome(503, { error: "x", code: "llm_not_configured" }) as { needsKeyConfig: boolean };
    expect(outcome.needsKeyConfig).toBe(true);
  });
});

describe("resolveApplyOutcome：生效响应归类", () => {
  it("200 → 已生效：携带新 packId、分类与版本号", () => {
    const outcome = resolveApplyOutcome(200, { ok: true, packId: "library-loan@v2", changeClass: "B", versionLabel: "v2" });
    expect(outcome).toEqual({ phase: "applied", packId: "library-loan@v2", changeClass: "B", versionLabel: "v2" });
  });

  it("422 → 闸门拒绝回报告态", () => {
    const outcome = resolveApplyOutcome(422, { ok: false, report: passedReport });
    expect(outcome.phase).toBe("gate-rejected");
  });

  it("409 → 错误态（基础名被改 / 无差异，均不可重试）", () => {
    const outcome = resolveApplyOutcome(409, { code: "base_name_changed", error: "packId 基础名不可修改" });
    expect(outcome.phase).toBe("error");
    if (outcome.phase !== "error") throw new Error("unreachable");
    expect(outcome.retryable).toBe(false);
    expect(outcome.message).toContain("基础名");
  });
});
