// 域包生成流程状态转移纯函数单测（票 #60 / spec #53 目标②）：
// 「表单 → 同步等待 → 验证报告 → 确认发布」链路的决策逻辑抽成纯函数，
// 覆盖表单校验、生成响应归类（200/502/503）、发布响应归类（200/422）三个 seam。
// 组件层只按转移结果渲染，不在 JSX 里散落分支判断。
import { describe, expect, it } from "vitest";
import {
  validateGeneratorForm,
  resolveGenerateOutcome,
  resolvePublishOutcome,
} from "@/components/domain-pack-generation-flow";
import type { GateReport } from "@/kernel/domain-pack-gate";

const passedReport: GateReport = {
  passed: true,
  structural: { status: "通过", issues: [], checkedTables: 3, checkedTemplates: 30 },
  generation: { status: "通过", issues: [], seeds: [20260101, 42] },
  selfJudging: { status: "通过", issues: [], checkedTemplates: 30, seed: 20260101 },
};

describe("validateGeneratorForm：生成表单校验", () => {
  it("场景描述必填（纯空白视为空）", () => {
    expect(validateGeneratorForm({ description: "   " })).toEqual(["场景描述不能为空"]);
    expect(validateGeneratorForm({ description: "图书馆借阅场景" })).toEqual([]);
  });

  it("表数意愿给出时必须是 3-5 的整数，留空合法", () => {
    expect(validateGeneratorForm({ description: "x", tableCount: "3" })).toEqual([]);
    expect(validateGeneratorForm({ description: "x", tableCount: "" })).toEqual([]);
    expect(validateGeneratorForm({ description: "x", tableCount: "2" })).toEqual([
      "表数意愿必须是 3-5 的整数",
    ]);
    expect(validateGeneratorForm({ description: "x", tableCount: "3.5" })).toEqual([
      "表数意愿必须是 3-5 的整数",
    ]);
    expect(validateGeneratorForm({ description: "x", tableCount: "abc" })).toEqual([
      "表数意愿必须是 3-5 的整数",
    ]);
  });
});

describe("resolveGenerateOutcome：生成响应归类", () => {
  it("200 且闸门通过 → 进入报告态并可发布，附草稿摘要", () => {
    const draft = {
      packId: "library-borrow",
      name: "图书馆借阅",
      schemaSkeleton: [{}, {}, {}],
      templates: Array.from({ length: 30 }, (_, i) => ({ templateId: `t-${i}`, difficulty: (i % 5) + 1 })),
    };
    const outcome = resolveGenerateOutcome(200, { draft, report: passedReport });
    expect(outcome.phase).toBe("report");
    if (outcome.phase === "report") {
      expect(outcome.report.passed).toBe(true);
      expect(outcome.summary?.name).toBe("图书馆借阅");
      expect(outcome.draft).toBe(draft);
    }
  });

  it("200 但闸门拒绝 → 报告态不可发布（教师改描述后重试）", () => {
    const report: GateReport = {
      ...passedReport,
      passed: false,
      structural: { status: "失败", checkedTables: 0, checkedTemplates: 0, issues: [{ check: "结构", message: "表数必须为 3-5，实际 2" }] },
      generation: { status: "跳过", issues: [], seeds: [20260101, 42] },
      selfJudging: { status: "跳过", issues: [], checkedTemplates: 0, seed: 20260101 },
    };
    const outcome = resolveGenerateOutcome(200, { draft: { packId: "x" }, report });
    expect(outcome.phase).toBe("report");
    if (outcome.phase === "report") expect(outcome.summary).toBeNull();
  });

  it("502（LLM 失败/JSON 非法）→ 错误态可重试，错误文案透传", () => {
    const outcome = resolveGenerateOutcome(502, { code: "llm_error", error: "LLM 网络请求失败", retryable: true });
    expect(outcome).toEqual({
      phase: "error",
      message: "LLM 网络请求失败",
      retryable: true,
      needsKeyConfig: false,
    });
  });

  it("503（未配置 key）→ 错误态提示需配置 DEEPSEEK_API_KEY，非重试文案", () => {
    const outcome = resolveGenerateOutcome(503, { code: "llm_not_configured", error: "LLM 未配置：请在服务端设置 DEEPSEEK_API_KEY" });
    expect(outcome).toEqual({
      phase: "error",
      message: "LLM 未配置：请在服务端设置 DEEPSEEK_API_KEY",
      retryable: true,
      needsKeyConfig: true,
    });
  });

  it("非 JSON 响应/网络异常 → 错误态给通用可重试文案", () => {
    expect(resolveGenerateOutcome(0, null)).toEqual({
      phase: "error",
      message: "生成请求失败，请稍后重试",
      retryable: true,
      needsKeyConfig: false,
    });
  });
});

describe("resolvePublishOutcome：发布响应归类", () => {
  it("200 → 发布成功（packId 供成功反馈）", () => {
    expect(resolvePublishOutcome(200, { ok: true, packId: "library-borrow" })).toEqual({
      phase: "published",
      packId: "library-borrow",
    });
  });

  it("422（服务端重过闸门拒绝）→ 回报告态并替换为新报告", () => {
    const outcome = resolvePublishOutcome(422, { ok: false, report: passedReport });
    expect(outcome.phase).toBe("gate-rejected");
    if (outcome.phase === "gate-rejected") expect(outcome.report).toBe(passedReport);
  });

  it("其他失败 → 错误态可重试", () => {
    expect(resolvePublishOutcome(500, null)).toEqual({
      phase: "error",
      message: "发布失败，请稍后重试",
      retryable: true,
      needsKeyConfig: false,
    });
  });
});
