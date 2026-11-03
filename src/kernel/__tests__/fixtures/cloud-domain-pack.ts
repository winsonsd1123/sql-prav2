// 云端域包夹具（票 #57）：手造纯 JSON 数据资产，供加载层单测与 e2e 复用。
// 与 #56 闸门夹具同构（学生-课程-成绩三表），差异在于知识点清单覆盖全部七类
// （抽题要求清单内每个知识点至少一道模板，否则开练抛错——清单为域包必带字段，#84 起无回退）。

/** 三表骨架：学生（含入学日期列，供日期函数类模板）-课程-成绩（双外键） */
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
        { columnRole: "入学日期", type: "TEXT", valuePool: ["2022-09-05", "2023-09-01", "2024-03-01"] },
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

function mkTiers() {
  return [
    { level: 1, name: "入门", description: "单表全量投影", sampleSql: "SELECT 姓名 FROM 学生" },
    { level: 2, name: "基础", description: "条件筛选与排序", sampleSql: "SELECT 姓名 FROM 学生 WHERE 城市 = '北京'" },
    { level: 3, name: "进阶", description: "聚合与分组", sampleSql: "SELECT 城市, COUNT(*) FROM 学生 GROUP BY 城市" },
    { level: 4, name: "综合", description: "多表 JOIN 与子查询", sampleSql: "SELECT 姓名 FROM 学生 WHERE 学号 IN (SELECT 学号 FROM 成绩 WHERE 分数 >= 95)" },
    { level: 5, name: "挑战", description: "多表综合应用", sampleSql: "SELECT 姓名, 课程名, 分数 FROM 成绩 JOIN 学生 ON 学生.学号 = 成绩.学号 JOIN 课程 ON 课程.课程号 = 成绩.课程号" },
  ];
}

/** 覆盖当前抽题顺序七类的知识点清单（顺序与 question-picking 的 knowledgeAreaOrder 一致） */
export const CLOUD_FIXTURE_KNOWLEDGE_AREAS = [
  "单表查询与投影",
  "条件筛选与排序",
  "聚合与分组",
  "多表 JOIN",
  "子查询",
  "日期函数",
  "综合应用",
] as const;

/** 七类各 4 道 = 28 道模板；参考答案全部可执行且结果非空（闸门自判检查口径） */
function mkTemplates() {
  const templates = [];
  for (let i = 1; i <= 28; i++) {
    const areaIndex = (i - 1) % 7;
    const difficulty = (areaIndex % 5) + 1;
    const area = CLOUD_FIXTURE_KNOWLEDGE_AREAS[areaIndex];
    const referenceAnswer =
      areaIndex === 0
        ? i % 2 === 1
          ? "SELECT {{col.学生.姓名}} FROM {{table.学生}}"
          : "SELECT DISTINCT {{col.学生.城市}} FROM {{table.学生}}"
        : areaIndex === 1
          ? "SELECT {{col.成绩.学号}} FROM {{table.成绩}} WHERE {{col.成绩.分数}} <= 100"
          : areaIndex === 2
            ? "SELECT COUNT(*) AS n FROM {{table.成绩}}"
            : areaIndex === 3
              ? "SELECT {{col.学生.姓名}}, {{col.成绩.分数}} FROM {{table.成绩}} JOIN {{table.学生}} ON {{table.成绩}}.{{col.成绩.学号}} = {{table.学生}}.{{col.学生.学号}}"
              : areaIndex === 4
                ? "SELECT {{col.学生.姓名}} FROM {{table.学生}} WHERE {{col.学生.学号}} IN (SELECT {{col.成绩.学号}} FROM {{table.成绩}})"
                : areaIndex === 5
                  ? "SELECT {{col.学生.姓名}}, date({{col.学生.入学日期}}) AS 入学日 FROM {{table.学生}}"
                  : "SELECT {{col.学生.姓名}}, {{col.课程.课程名}}, {{col.成绩.分数}} FROM {{table.成绩}} JOIN {{table.学生}} ON {{table.成绩}}.{{col.成绩.学号}} = {{table.学生}}.{{col.学生.学号}} JOIN {{table.课程}} ON {{table.成绩}}.{{col.成绩.课程号}} = {{table.课程}}.{{col.课程.课程号}}";
    templates.push({
      templateId: `cloud-tpl-${String(i).padStart(2, "0")}`,
      knowledgeArea: area,
      difficulty,
      prompt: `云端夹具第 ${i} 题：${area}类练习。`,
      hints: ["思路提示。", "关键子句提示。"],
      referenceAnswer,
      ordered: false,
    });
  }
  return templates;
}

/** 合法云端域包 JSON 夹具：过闸门、且七知识点全覆盖可直接开练 */
export function mkCloudPackJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    packId: "cloud-fixture-pack",
    name: "云端夹具域包",
    schemaSkeleton: mkSchema(),
    templates: mkTemplates(),
    knowledgeAreas: [...CLOUD_FIXTURE_KNOWLEDGE_AREAS],
    difficultyTiers: mkTiers(),
    practiceConfig: { totalQuestions: 10, tierDistribution: { "1": 2, "2": 2, "3": 2, "4": 2, "5": 2 } },
    ...overrides,
  };
}
