import { describe, expect, it } from "vitest";
import { generateSession } from "@/kernel/generate";
import { judge } from "@/kernel/judge";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";

/**
 * T5 · 四层随机化与结构性防抄袭。
 * 接缝：generateSession(种子, 域包) 与 judge(SQL, 会话, 题目)。
 * 防抄袭测试只断言"判定为错误"，不断言错误文案格式（归 T2 管辖）。
 */

/** 在一批种子中找到与基准会话"学生"表实际表名不同的种子（确定性：种子遍历顺序固定） */
function 找异名种子(基准会话: ReturnType<typeof generateSession>, 域包: ReturnType<typeof 加载域包A>): number {
  const 基准表名 = 基准会话.database.tables[0].tableName;
  for (let 种子 = 1; 种子 <= 200; 种子++) {
    if (generateSession(种子, 域包).database.tables[0].tableName !== 基准表名) return 种子;
  }
  throw new Error("200 个种子内未出现表名差异，候选池随机化失效");
}

describe("四层随机化", () => {
  const 域包 = 加载域包A();

  it("同种子字节级一致（T1 既有红线，覆盖新随机层后仍成立）", () => {
    expect(JSON.stringify(generateSession(20260101, 域包))).toBe(JSON.stringify(generateSession(20260101, 域包)));
  });

  it("实际表名/列名均取自候选池", () => {
    const 表名池 = 域包.schemaSkeleton.map((t) => t.tableNamePool ?? [t.tableRole]).flat();
    const 会话 = generateSession(20260101, 域包);
    for (const 表 of 会话.database.tables) {
      expect(表名池).toContain(表.tableName);
      const 骨架 = 域包.schemaSkeleton.find((t) => (t.tableNamePool ?? [t.tableRole]).includes(表.tableName))!;
      const 列名池 = [...(骨架.serialKey?.columnNamePool ?? [骨架.serialKey?.columnRole]), ...骨架.columns.flatMap((c) => c.columnNamePool ?? [c.columnRole])].filter(Boolean);
      for (const 列名 of 表.columnNames) {
        expect(列名池).toContain(列名);
      }
    }
  });

  it("异种子：表名与列名实例实质不同，参数不同", () => {
    const a = generateSession(20260101, 域包);
    const b = generateSession(找异名种子(a, 域包), 域包);
    expect(a.database.tables[0].tableName).not.toBe(b.database.tables[0].tableName);
    // 至少有一张表存在列名实例差异（表内列序对齐：骨架列序一致）
    const 有列名差异 = a.database.tables.some((表, i) =>
      表.columnNames.some((列名, j) => 列名 !== b.database.tables[i].columnNames[j]),
    );
    expect(有列名差异).toBe(true);
    // 题面随参数变化：跨一批种子，同一模板的题面出现不止一种取值
    const 题面集合 = new Set<string>();
    for (let 种子 = 1; 种子 <= 30; 种子++) {
      题面集合.add(generateSession(种子, 域包).questions.find((q) => q.templateId === "single-where-score")!.prompt);
    }
    expect(题面集合.size).toBeGreaterThan(1);
  });

  it("数据层：每表 15-50 行，且跨种子可见刻意注入的 NULL 与空串", () => {
    const 会话 = generateSession(20260101, 域包);
    for (const 表 of 会话.database.tables) {
      expect(表.rows.length).toBeGreaterThanOrEqual(15);
      expect(表.rows.length).toBeLessThanOrEqual(50);
    }
    const 值集合 = new Set<(string | number | null)>();
    for (let 种子 = 1; 种子 <= 30; 种子++) {
      for (const 表 of generateSession(种子, 域包).database.tables) {
        for (const 行 of 表.rows) for (const 值 of 行) 值集合.add(值);
      }
    }
    expect(值集合.has(null)).toBe(true);
    expect(值集合.has("")).toBe(true);
  });
});

/** T6：题库含仅引用课程表/成绩表的模板，防抄袭对撞会话需三张表实际名全部相异 */
function 找全表异名种子(基准会话: ReturnType<typeof generateSession>, 域包: ReturnType<typeof 加载域包A>): number {
  const 基准表名们 = 基准会话.database.tables.map((t) => t.tableName);
  for (let 种子 = 1; 种子 <= 500; 种子++) {
    const 表名们 = generateSession(种子, 域包).database.tables.map((t) => t.tableName);
    if (基准表名们.every((名, i) => 名 !== 表名们[i])) return 种子;
  }
  throw new Error("500 个种子内未出现全表名差异，候选池随机化失效");
}

describe("结构性防抄袭", () => {
  const 域包 = 加载域包A();
  const 会话A = generateSession(20260101, 域包);
  const 会话B = generateSession(找全表异名种子(会话A, 域包), 域包);

  it("前置：A 会话参考答案自判通过", async () => {
    for (const 题目 of 会话A.questions) {
      expect((await judge(题目.referenceAnswer, 会话A, 题目)).judge).toBe("通过");
    }
  });

  it("A 会话通过的 SQL 原文在 B 会话判定失败（列名不同）", async () => {
    for (let i = 0; i < 会话A.database.tables.length; i++) {
      expect(会话A.database.tables[i].tableName).not.toBe(会话B.database.tables[i].tableName);
    }
    // 全部模板均以实际表名/列名书写（中文标识符无点号限定），换会话即因表/列不存在而失败
    const 涉及列名的SQL = 会话A.questions.map((q) => q.referenceAnswer);
    expect(涉及列名的SQL.length).toBeGreaterThan(0);
    const 结果们 = await Promise.all(
      涉及列名的SQL.map(async (sql, i) =>
        judge(sql, 会话B, 会话B.questions[i]),
      ),
    );
    for (const 结果 of 结果们) {
      expect(结果.judge).not.toBe("通过"); // 表/列不存在 → 错误或不通过，绝不通过
    }
    // 至少一条因表/列不存在触发引擎错误（具体文案格式归 T2 管辖，此处不断言）
    expect(结果们.some((r) => r.judge === "错误")).toBe(true);
  });

  it("B 会话用自己的参考答案仍全部通过（随机化不破坏可作答性）", async () => {
    for (const 题目 of 会话B.questions) {
      expect((await judge(题目.referenceAnswer, 会话B, 题目)).judge).toBe("通过");
    }
  });
});
