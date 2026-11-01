// 域包管理页视图模型纯函数单测（票 #60 / spec #53 目标②）：
// 覆盖「生成报告 → 确认发布」链路的两个数据整形 seam——
// 草稿关键信息摘要（发布确认前的核对）与验证报告三段视图模型（人类可读渲染的数据源）。
// 夹具复用 #56 闸门测试的 GateReport 口径（结构/生成/自判 + 通过/失败/跳过三态）。
import { describe, expect, it } from "vitest";
import {
  buildDraftSummary,
  buildGateReportSections,
} from "@/components/domain-pack-admin-view-model";
import type { GateReport } from "@/kernel/domain-pack-gate";

/** 合法草稿形状的最小夹具（口径与 #56 mkPackJson 一致，字段按本测试所需裁剪） */
function mkDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const templates = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5].map((difficulty, i) => ({
    templateId: `t-${i}`,
    difficulty,
  }));
  return {
    packId: "library-borrow",
    name: "图书馆借阅",
    schemaSkeleton: [{ tableRole: "读者" }, { tableRole: "图书" }, { tableRole: "借阅记录" }],
    templates,
    ...overrides,
  };
}

describe("buildDraftSummary：草稿关键信息摘要（确认发布前核对）", () => {
  it("从草稿 JSON 提取名称/表数/模板数与难度五档分布", () => {
    const summary = buildDraftSummary(mkDraft());
    expect(summary).toEqual({
      name: "图书馆借阅",
      packId: "library-borrow",
      tableCount: 3,
      templateCount: 10,
      tierCounts: { "1": 2, "2": 2, "3": 2, "4": 2, "5": 2 },
    });
  });

  it("难度分布按五档齐全补零（缺档模板数为 0 也占位）", () => {
    const summary = buildDraftSummary(mkDraft({ templates: [{ templateId: "t", difficulty: 3 }] }));
    expect(summary.tierCounts).toEqual({ "1": 0, "2": 0, "3": 1, "4": 0, "5": 0 });
  });

  it("结构不完整的草稿返回 null（调用方提示草稿无法摘要，不白屏）", () => {
    expect(buildDraftSummary({ packId: "x" })).toBeNull();
    expect(buildDraftSummary(null)).toBeNull();
    expect(buildDraftSummary("不是对象")).toBeNull();
  });
});

describe("buildGateReportSections：验证报告三段视图模型", () => {
  const passed: GateReport = {
    passed: true,
    structural: { status: "通过", issues: [], checkedTables: 3, checkedTemplates: 30 },
    generation: { status: "通过", issues: [], seeds: [20260101, 42] },
    selfJudging: { status: "通过", issues: [], checkedTemplates: 30, seed: 20260101 },
  };

  it("通过的报告产出三段「通过」、零条目", () => {
    const sections = buildGateReportSections(passed);
    expect(sections.map((s) => s.title)).toEqual(["结构检查", "生成检查", "自判检查"]);
    expect(sections.every((s) => s.status === "通过" && s.issues.length === 0)).toBe(true);
    expect(sections[0].detail).toContain("3 张表");
    expect(sections[0].detail).toContain("30 道模板");
  });

  it("失败段逐条透出 GateIssue 的中文 message 与模板定位", () => {
    const report: GateReport = {
      ...passed,
      passed: false,
      structural: {
        status: "失败",
        checkedTables: 0,
        checkedTemplates: 0,
        issues: [
          { check: "结构", message: "templates：模板数必须为 25-35，实际 10" },
          { check: "结构", templateId: "t-1", message: "模板 t-1 缺少参考答案" },
        ],
      },
      generation: { status: "跳过", issues: [], seeds: [20260101, 42] },
      selfJudging: { status: "跳过", issues: [], checkedTemplates: 0, seed: 20260101 },
    };
    const sections = buildGateReportSections(report);
    expect(sections[0].status).toBe("失败");
    expect(sections[0].issues.map((i) => i.message)).toEqual([
      "templates：模板数必须为 25-35，实际 10",
      "模板 t-1 缺少参考答案",
    ]);
    expect(sections[0].issues[1].templateId).toBe("t-1");
    expect(sections[1].status).toBe("跳过");
    expect(sections[2].status).toBe("跳过");
  });

  it("生成段带种子明细、自判段带覆盖模板数（detail 供界面副注）", () => {
    const report: GateReport = {
      ...passed,
      generation: {
        status: "失败",
        seeds: [20260101, 42],
        issues: [{ check: "生成", seed: 42, message: "会话生成失败：引用了未生成的表" }],
      },
    };
    const sections = buildGateReportSections(report);
    expect(sections[1].detail).toContain("20260101");
    expect(sections[1].issues[0].seed).toBe(42);
    expect(sections[2].detail).toContain("30");
  });
});

describe("buildDomainPackListRows：域包列表行视图模型（内置 + 云端合并）", () => {
  it("每包一行概览（表数/模板数/五档概览/来源），放出状态随清单派生", async () => {
    const { buildDomainPackListRows } = await import("@/components/domain-pack-admin-view-model");
    const { builtinDomainPacks } = await import("@/components/domain-pack-registry");
    const { assetToKernelPack } = await import("@/kernel/domain-pack-contract");
    const { builtinPackAssets } = await import("@/domain-packs/builtin-packs");
    // 云端一个新包 + 一个与内置同 id 的行（合并语义：同 id 只覆盖演练配置，列表仍是一行「内置」）
    const cloudOnly = assetToKernelPack({ ...builtinPackAssets[0], packId: "library-borrow", name: "图书馆借阅" });
    const sameIdAsBuiltin = assetToKernelPack(builtinPackAssets[1]);

    const rows = buildDomainPackListRows(builtinDomainPacks, [cloudOnly, sameIdAsBuiltin], new Set(["student-course-grade"]));

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      packId: "student-course-grade",
      name: "学生-课程-成绩",
      source: "内置",
      tableCount: 3,
      exposed: true,
    });
    expect(rows[1]).toMatchObject({ packId: "employee-department-payroll", source: "内置", exposed: false });
    expect(rows[2]).toMatchObject({ packId: "library-borrow", name: "图书馆借阅", source: "云端", exposed: false });
    // 五档概览：从模板难度统计且五档占位（内置包A 各档模板数 > 0）
    const tierSum = Object.values(rows[0].tierOverview).reduce((a, b) => a + b, 0);
    expect(tierSum).toBe(builtinDomainPacks[0].templates.length);
    expect(Object.keys(rows[0].tierOverview)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("放出清单为 null（未配置 = 默认全部放出）时所有行 exposed 为 true", async () => {
    const { buildDomainPackListRows } = await import("@/components/domain-pack-admin-view-model");
    const { builtinDomainPacks } = await import("@/components/domain-pack-registry");
    const rows = buildDomainPackListRows(builtinDomainPacks, [], null);
    expect(rows.every((r) => r.exposed)).toBe(true);
  });
});
