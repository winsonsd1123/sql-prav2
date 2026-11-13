// 演练配置保存响应归类纯函数单测（票 #115）：
// PUT 422 { ok:false, report }（闸门拒绝，与发布路由同口径）的 report 各段问题
// 必须整形为可读中文清单透出——此前组件只读 error/errors 字段，闸门拒绝只剩兜底文案。
// 400 契约错误清单（errors 数组）与 error 字符串的既有口径在此锁死不回归。
import { describe, expect, it } from "vitest";
import { resolvePracticeConfigSaveMessages } from "@/components/practice-config-save-flow";
import type { GateReport } from "@/kernel/domain-pack-gate";

const gateRejectedReport: GateReport = {
  passed: false,
  structural: {
    status: "失败",
    checkedTables: 3,
    checkedTemplates: 30,
    issues: [{ check: "结构", templateId: "tpl-01", message: "难度必须是 1-5，实际 9" }],
  },
  generation: { status: "跳过", issues: [], seeds: [20260101, 42] },
  selfJudging: { status: "跳过", issues: [], checkedTemplates: 0, seed: 20260101 },
};

describe("resolvePracticeConfigSaveMessages：保存失败响应归类为 toast 文案清单", () => {
  it("422 闸门拒绝（report 带问题）→ 首条给出闸门语境，问题逐条可读中文透出", () => {
    expect(resolvePracticeConfigSaveMessages({ ok: false, report: gateRejectedReport })).toEqual([
      "保存被验证闸门拒绝",
      "[结构]（tpl-01） 难度必须是 1-5，实际 9",
    ]);
  });

  it("400 契约错误清单（errors 数组）→ 原样逐条透出（票 #117 口径不回归）", () => {
    expect(
      resolvePracticeConfigSaveMessages({ errors: ["总题数必须是正整数", "各档配额总和（11）必须等于总题数（10）"] }),
    ).toEqual(["总题数必须是正整数", "各档配额总和（11）必须等于总题数（10）"]);
  });

  it("error 字符串（如 404 域包不存在）→ 单条透出", () => {
    expect(resolvePracticeConfigSaveMessages({ error: "域包不存在" })).toEqual(["域包不存在"]);
  });

  it("body 解析失败（null）→ 兜底文案", () => {
    expect(resolvePracticeConfigSaveMessages(null)).toEqual(["演练配置保存失败"]);
  });

  it("report 无任何问题（防御：非闸门拒绝形状）→ 不当作闸门拒绝，走兜底", () => {
    const passed: GateReport = { ...gateRejectedReport, passed: true, structural: { ...gateRejectedReport.structural, status: "通过", issues: [] } };
    expect(resolvePracticeConfigSaveMessages({ ok: true, report: passed })).toEqual(["演练配置保存失败"]);
  });
});
