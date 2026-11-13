import { describe, expect, it } from "vitest";
import { parseDomainPackJson } from "@/kernel/domain-pack-contract";
import {
  formatGateIssueLines,
  formatGateReport,
  validateDomainPack,
  GATE_TEST_SEEDS,
} from "@/kernel/domain-pack-gate";
import type { GateReport } from "@/kernel/domain-pack-gate";

/**
 * 域包验证闸门（票 #56）：域包 JSON → 结构/生成/自判三类验证报告。
 * 契约口径：库骨架 3-5 表、模板 25-35、有序知识点清单、难度 1-5 档定义、演练配置（总题数+各档分布）。
 * 夹具为手造纯 JSON（不依赖内置两包的代码态定义）。
 */

/** 三表骨架：学生-课程-成绩（成绩双外键），全部字段为可 JSON 序列化的标量/数组/对象 */
function mkSchema() {
  return [
    {
      tableRole: "学生",
      tableNamePool: ["学生", "学员"],
      serialKey: { columnRole: "学号", columnNamePool: ["学号", "学生编号"], startValue: 2024001 },
      rowCount: 20,
      columns: [
        { columnRole: "姓名", columnNamePool: ["姓名", "名字"], type: "TEXT", valuePool: ["张伟", "李娜", "王强", "刘洋", "陈静"] },
        { columnRole: "城市", type: "TEXT", valuePool: ["北京", "上海", "广州", ""], nullProbability: 0.1 },
      ],
    },
    {
      tableRole: "课程",
      serialKey: { columnRole: "课程号", startValue: 101 },
      rowCount: 15,
      columns: [{ columnRole: "课程名", type: "TEXT", valuePool: ["高等数学", "数据结构", "操作系统", "大学英语"] }],
    },
    {
      tableRole: "成绩",
      rowCount: 40,
      columns: [
        { columnRole: "学号", type: "INTEGER", valuePool: [], reference: { table: "学生", column: "学号" } },
        { columnRole: "课程号", type: "INTEGER", valuePool: [], reference: { table: "课程", column: "课程号" } },
        { columnRole: "分数", type: "INTEGER", valuePool: [55, 60, 72, 80, 95, 100], nullProbability: 0.15 },
      ],
    },
  ];
}

/** 难度 1-5 档定义：名称 + 描述 + 代表 SQL 样例（固定五档） */
function mkTiers() {
  return [
    { level: 1, name: "入门", description: "单表全量投影", sampleSql: "SELECT 姓名 FROM 学生" },
    { level: 2, name: "基础", description: "条件筛选与排序", sampleSql: "SELECT 姓名 FROM 学生 WHERE 城市 = '北京'" },
    { level: 3, name: "进阶", description: "聚合与分组", sampleSql: "SELECT 城市, COUNT(*) FROM 学生 GROUP BY 城市" },
    { level: 4, name: "综合", description: "多表 JOIN", sampleSql: "SELECT 姓名, 分数 FROM 学生 JOIN 成绩 ON 学生.学号 = 成绩.学号" },
    { level: 5, name: "挑战", description: "子查询与综合应用", sampleSql: "SELECT 姓名 FROM 学生 WHERE 学号 IN (SELECT 学号 FROM 成绩 WHERE 分数 >= 95)" },
  ];
}

/** 25 道模板：五种题型各 5 道，难度按 1-3 分布（与演练配置分布匹配），全部非空结果 */
function mkTemplates() {
  const templates = [];
  for (let i = 1; i <= 25; i++) {
    const kind = (i - 1) % 5;
    const difficulty = kind <= 1 ? 1 : kind <= 3 ? 2 : 3;
    const area = kind <= 1 ? "单表查询与投影" : kind === 2 ? "条件筛选与排序" : kind === 3 ? "聚合与分组" : "多表 JOIN";
    templates.push({
      templateId: `tpl-${String(i).padStart(2, "0")}`,
      knowledgeArea: area,
      difficulty,
      prompt: `第 ${i} 题：查询${area}类练习。`,
      hints: ["思路提示。", "关键子句提示。"],
      referenceAnswer:
        kind === 0
          ? "SELECT {{col.学生.姓名}} FROM {{table.学生}}"
          : kind === 1
            ? "SELECT DISTINCT {{col.学生.城市}} FROM {{table.学生}}"
            : kind === 2
              ? "SELECT {{col.学生.姓名}} FROM {{table.学生}} WHERE {{col.学生.城市}} = '北京'"
              : kind === 3
                ? "SELECT {{col.课程.课程名}}, COUNT(*) AS n FROM {{table.成绩}} JOIN {{table.课程}} ON {{table.成绩}}.{{col.成绩.课程号}} = {{table.课程}}.{{col.课程.课程号}} GROUP BY {{col.课程.课程名}}"
                : "SELECT {{col.学生.姓名}} FROM {{table.学生}} JOIN {{table.成绩}} ON {{table.学生}}.{{col.学生.学号}} = {{table.成绩}}.{{col.成绩.学号}} WHERE {{col.成绩.分数}} >= 60",
      ordered: false,
      ...(kind === 2 ? { paramPool: {} } : {}),
    });
  }
  return templates;
}

/** 取夹具第 ti 张表的列数组（仅测试内改写夹具用） */
function columnsOf(json: Record<string, unknown>, ti: number): Record<string, unknown>[] {
  return (json.schemaSkeleton as Record<string, unknown>[])[ti].columns as Record<string, unknown>[];
}

/** 合法域包 JSON 夹具（手造，纯 JSON） */
function mkPackJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    packId: "fixture-pack",
    name: "夹具域包",
    schemaSkeleton: mkSchema(),
    templates: mkTemplates(),
    knowledgeAreas: ["单表查询与投影", "条件筛选与排序", "聚合与分组", "多表 JOIN"],
    difficultyTiers: mkTiers(),
    practiceConfig: { totalQuestions: 10, tierDistribution: { "1": 4, "2": 4, "3": 2, "4": 0, "5": 0 } },
    ...overrides,
  };
}

describe("JSON 契约校验：parseDomainPackJson", () => {
  it("合法域包解析成功，产出可序列化资产", () => {
    const result = parseDomainPackJson(mkPackJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.packId).toBe("fixture-pack");
    expect(result.pack.schemaSkeleton).toHaveLength(3);
    expect(result.pack.templates).toHaveLength(25);
    expect(result.pack.difficultyTiers.map((t) => t.level)).toEqual([1, 2, 3, 4, 5]);
    // 纯 JSON 契约：序列化往返无损（无函数、无 undefined 语义丢失）
    expect(JSON.parse(JSON.stringify(result.pack))).toEqual(result.pack);
  });

  it("顶层缺字段给出含字段路径的人类可读错误", () => {
    const result = parseDomainPackJson({ packId: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const joined = result.errors.join("\n");
    for (const field of ["name", "schemaSkeleton", "templates", "knowledgeAreas", "difficultyTiers", "practiceConfig"]) {
      expect(joined).toContain(field);
    }
  });

  it("非对象输入被拒绝且错误可读", () => {
    const result = parseDomainPackJson("不是域包");
    expect(result.ok).toBe(false);
  });

  it("列类型非法被检出并指明表与列", () => {
    const json = mkPackJson();
    columnsOf(json, 0)[0].type = "FLOAT";
    const result = parseDomainPackJson(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toMatch(/学生.*姓名.*FLOAT|type/);
  });

  it("难度档位必须恰好 1-5 五档", () => {
    const json = mkPackJson();
    json.difficultyTiers = mkTiers().slice(0, 4);
    expect(parseDomainPackJson(json).ok).toBe(false);
    const json2 = mkPackJson();
    json2.difficultyTiers = mkTiers().map((t) => (t.level === 3 ? { ...t, level: 6 } : t));
    const r = parseDomainPackJson(json2);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toContain("难度档位");
  });

  it("演练配置：各档分布总和必须等于总题数", () => {
    const json = mkPackJson();
    json.practiceConfig = { totalQuestions: 10, tierDistribution: { "1": 4, "2": 4, "3": 1, "4": 0, "5": 0 } };
    const result = parseDomainPackJson(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toMatch(/分布|总题数/);
  });

  it("演练配置：某档配额超过该档模板数被检出", () => {
    const json = mkPackJson();
    json.practiceConfig = { totalQuestions: 12, tierDistribution: { "1": 4, "2": 4, "3": 2, "4": 2, "5": 0 } };
    const result = parseDomainPackJson(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("4");
  });
});

describe("验证闸门：validateDomainPack", () => {
  it("合法域包三类检查全部通过，报告 passed 为 true", async () => {
    const report = await validateDomainPack(mkPackJson());
    expect(report.passed).toBe(true);
    expect(report.structural.status).toBe("通过");
    expect(report.generation.status).toBe("通过");
    expect(report.selfJudging.status).toBe("通过");
    expect(report.generation.seeds).toEqual(GATE_TEST_SEEDS);
    expect(report.selfJudging.checkedTemplates).toBe(25);
  });

  it("结构失败：表数不足 3、模板数不足 25、难度越界、知识点不在清单、引用列不存在", async () => {
    // 表数不足（去掉成绩表同时删掉引用它的模板占位符成本高，直接构造独立小包）
    const tooFewTables = mkPackJson({ schemaSkeleton: mkSchema().slice(0, 2) });
    const r1 = await validateDomainPack(tooFewTables);
    expect(r1.passed).toBe(false);
    expect(r1.structural.issues.some((i) => i.message.includes("表"))).toBe(true);
    // 结构失败时生成与自判跳过
    expect(r1.generation.status).toBe("跳过");
    expect(r1.selfJudging.status).toBe("跳过");

    const tooFewTemplates = mkPackJson({ templates: mkTemplates().slice(0, 24) });
    const r2 = await validateDomainPack(tooFewTemplates);
    expect(r2.structural.issues.some((i) => i.message.includes("模板"))).toBe(true);

    const badDifficulty = mkPackJson();
    badDifficulty.templates = mkTemplates().map((t, i) => (i === 0 ? { ...t, difficulty: 6 } : t));
    const r3 = await validateDomainPack(badDifficulty);
    expect(r3.structural.issues.some((i) => i.message.includes("难度"))).toBe(true);

    const badArea = mkPackJson();
    badArea.templates = mkTemplates().map((t, i) => (i === 0 ? { ...t, knowledgeArea: "不存在的知识点" } : t));
    const r4 = await validateDomainPack(badArea);
    expect(r4.structural.issues.some((i) => i.message.includes("知识点"))).toBe(true);

    const badRef = mkPackJson();
    columnsOf(badRef, 2)[0].reference = { table: "学生", column: "不存在的列" };
    const r5 = await validateDomainPack(badRef);
    expect(r5.structural.issues.some((i) => i.message.includes("reference") || i.message.includes("引用"))).toBe(true);
  });

  it("结构失败：引用依赖成环被拓扑排序判定检出", async () => {
    const json = mkPackJson();
    // 成绩.学号 引用 学生；让学生.城市 反向引用 成绩.分数 形成环
    columnsOf(json, 0)[1].reference = { table: "成绩", column: "分数" };
    const report = await validateDomainPack(json);
    expect(report.passed).toBe(false);
    expect(report.structural.issues.some((i) => i.message.includes("环") || i.message.includes("拓扑"))).toBe(true);
  });

  it("生成失败：被引用表 0 行导致引用池为空，报告生成检查失败并给出中文明细", async () => {
    const json = mkPackJson();
    (json.schemaSkeleton as Record<string, unknown>[])[1].rowCount = 0; // 课程表 0 行 → 成绩.课程号 引用池为空
    const report = await validateDomainPack(json);
    expect(report.passed).toBe(false);
    expect(report.generation.status).toBe("失败");
    expect(report.generation.issues.some((i) => i.message.includes("引用候选池为空"))).toBe(true);
    // 生成失败后自判跳过
    expect(report.selfJudging.status).toBe("跳过");
  });

  it("自判失败：参考答案语法不可执行被逐题报告", async () => {
    const json = mkPackJson();
    json.templates = mkTemplates().map((t, i) => (i === 0 ? { ...t, referenceAnswer: "SELECT FORM {{table.学生}}" } : t));
    const report = await validateDomainPack(json);
    expect(report.passed).toBe(false);
    expect(report.selfJudging.status).toBe("失败");
    expect(report.selfJudging.issues.some((i) => i.templateId === "tpl-01")).toBe(true);
  });

  it("自判失败：参考答案结果为空被检出", async () => {
    const json = mkPackJson();
    json.templates = mkTemplates().map((t, i) =>
      i === 0 ? { ...t, referenceAnswer: "SELECT {{col.学生.姓名}} FROM {{table.学生}} WHERE {{col.学生.城市}} = '不存在城市'" } : t,
    );
    const report = await validateDomainPack(json);
    expect(report.selfJudging.status).toBe("失败");
    expect(report.selfJudging.issues.some((i) => i.message.includes("空"))).toBe(true);
  });

  it("自判失败：模板占位符引用未知语义角色（不可实例化）被检出", async () => {
    const json = mkPackJson();
    json.templates = mkTemplates().map((t, i) => (i === 0 ? { ...t, prompt: "查询 {{col.学生.不存在的角色}}" } : t));
    const report = await validateDomainPack(json);
    expect(report.selfJudging.status).toBe("失败");
    expect(report.selfJudging.issues.some((i) => i.message.includes("不存在的角色"))).toBe(true);
  });

  it("formatGateReport 产出人类可读中文报告（含三类状态与失败明细）", async () => {
    const passing = formatGateReport(await validateDomainPack(mkPackJson()));
    expect(passing).toContain("结构检查：通过");
    expect(passing).toContain("生成检查：通过");
    expect(passing).toContain("自判检查：通过");

    const json = mkPackJson();
    json.templates = mkTemplates().map((t, i) => (i === 0 ? { ...t, difficulty: 9 } : t));
    const failing = formatGateReport(await validateDomainPack(json));
    expect(failing).toContain("结构检查：失败");
    expect(failing).toContain("tpl-01");
    expect(failing).toContain("生成检查：跳过");
    expect(failing).toContain("自判检查：跳过");
  });

  it("formatGateIssueLines 把各段问题整形为逐条中文清单（票 #115：422 拒绝提示用），全部通过为空清单", () => {
    const report: GateReport = {
      passed: false,
      structural: {
        status: "失败",
        checkedTables: 3,
        checkedTemplates: 30,
        issues: [
          { check: "结构", templateId: "tpl-01", message: "难度必须是 1-5，实际 9" },
          { check: "结构", message: "表数必须为 3-5，实际 2" },
        ],
      },
      generation: {
        status: "失败",
        seeds: [20260101, 42],
        issues: [{ check: "生成", seed: 42, message: "档5可用模板不足，生成会话失败" }],
      },
      selfJudging: { status: "跳过", checkedTemplates: 0, seed: 20260101, issues: [] },
    };
    expect(formatGateIssueLines(report)).toEqual([
      "[结构]（tpl-01） 难度必须是 1-5，实际 9",
      "[结构] 表数必须为 3-5，实际 2",
      "[生成]（种子 42） 档5可用模板不足，生成会话失败",
    ]);
    expect(formatGateIssueLines({ ...report, passed: true, structural: { ...report.structural, status: "通过", issues: [] }, generation: { ...report.generation, status: "通过", issues: [] }, selfJudging: { ...report.selfJudging, status: "通过" } })).toEqual([]);
  });

  // ── 圈选封闭校验（票 #82 / spec #75，ADR 0010「圈选即封闭」闸门侧强制）──
  // 圈选生成时产出清单必须 ⊆ 圈选集合（归一化名称层面判定）；越界记入结构检查报告。
  it("圈选集合外知识点被结构检查拒绝（封闭校验），集合内子集照常通过", async () => {
    // 越界：夹具清单含「多表 JOIN」，但圈选集合不含它
    const outOfClosure = await validateDomainPack(mkPackJson(), {
      knowledgeAreaAllowList: ["单表查询与投影", "条件筛选与排序", "聚合与分组"],
    });
    expect(outOfClosure.passed).toBe(false);
    expect(outOfClosure.structural.status).toBe("失败");
    expect(outOfClosure.structural.issues.some((i) => i.message.includes("多表 JOIN") && i.message.includes("圈选"))).toBe(true);
    // 封闭校验属结构检查，失败时生成/自判跳过
    expect(outOfClosure.generation.status).toBe("跳过");

    // 集合内子集：清单是圈选集合的真子集，照常全过
    const withinClosure = await validateDomainPack(mkPackJson(), {
      knowledgeAreaAllowList: ["单表查询与投影", "条件筛选与排序", "聚合与分组", "多表 JOIN", "日期函数"],
    });
    expect(withinClosure.passed).toBe(true);
  });

  it("未给圈选集合（缺省）时不做封闭校验：自由产出现状零差异", async () => {
    const report = await validateDomainPack(mkPackJson());
    expect(report.passed).toBe(true);
    expect(report.structural.issues.some((i) => i.message.includes("圈选"))).toBe(false);
  });
});
