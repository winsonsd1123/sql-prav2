import { describe, expect, it } from "vitest";
import { generateSession } from "@/kernel/generate";
import { judge } from "@/kernel/judge";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";

/**
 * T5 · 四层随机化与结构性防抄袭。
 * 接缝：generateSession(seed, pack) 与 judge(SQL, session, question)。
 * 防抄袭测试只断言"判定为错误"，不断言错误文案格式（归 T2 管辖）。
 */

/** 在一批种子中找到与基准会话"学生"表实际表名不同的种子（确定性：种子遍历顺序固定） */
function findRenamedSeed(baseSession: ReturnType<typeof generateSession>, pack: ReturnType<typeof loadPackA>): number {
  const baseTableName = baseSession.database.tables[0].tableName;
  for (let seed = 1; seed <= 200; seed++) {
    if (generateSession(seed, pack).database.tables[0].tableName !== baseTableName) return seed;
  }
  throw new Error("200 个种子内未出现表名差异，候选池随机化失效");
}

describe("四层随机化", () => {
  const pack = loadPackA();

  it("同种子字节级一致（T1 既有红线，覆盖新随机层后仍成立）", () => {
    expect(JSON.stringify(generateSession(20260101, pack))).toBe(JSON.stringify(generateSession(20260101, pack)));
  });

  it("实际表名/列名均取自候选池", () => {
    const tableNamePool = pack.schemaSkeleton.map((t) => t.tableNamePool ?? [t.tableRole]).flat();
    const session = generateSession(20260101, pack);
    for (const table of session.database.tables) {
      expect(tableNamePool).toContain(table.tableName);
      const skeleton = pack.schemaSkeleton.find((t) => (t.tableNamePool ?? [t.tableRole]).includes(table.tableName))!;
      const columnNamePool = [...(skeleton.serialKey?.columnNamePool ?? [skeleton.serialKey?.columnRole]), ...skeleton.columns.flatMap((c) => c.columnNamePool ?? [c.columnRole])].filter(Boolean);
      for (const column of table.columnNames) {
        expect(columnNamePool).toContain(column);
      }
    }
  });

  it("异种子：表名与列名实例实质不同，参数不同", () => {
    const a = generateSession(20260101, pack);
    const b = generateSession(findRenamedSeed(a, pack), pack);
    expect(a.database.tables[0].tableName).not.toBe(b.database.tables[0].tableName);
    // 至少有一张表存在列名实例差异（表内列序对齐：骨架列序一致）
    const hasColumnDiff = a.database.tables.some((table, i) =>
      table.columnNames.some((column, j) => column !== b.database.tables[i].columnNames[j]),
    );
    expect(hasColumnDiff).toBe(true);
    // 题面随参数变化：跨一批种子，同一模板的题面出现不止一种取值
    const promptSet = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      promptSet.add(generateSession(seed, pack).questions.find((q) => q.templateId === "single-where-score")!.prompt);
    }
    expect(promptSet.size).toBeGreaterThan(1);
  });

  it("数据层：每表 15-50 行，且跨种子可见刻意注入的 NULL 与空串", () => {
    const session = generateSession(20260101, pack);
    for (const table of session.database.tables) {
      expect(table.rows.length).toBeGreaterThanOrEqual(15);
      expect(table.rows.length).toBeLessThanOrEqual(50);
    }
    const valueSet = new Set<(string | number | null)>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const table of generateSession(seed, pack).database.tables) {
        for (const row of table.rows) for (const value of row) valueSet.add(value);
      }
    }
    expect(valueSet.has(null)).toBe(true);
    expect(valueSet.has("")).toBe(true);
  });
});

/** T6：题库含仅引用课程表/成绩表的模板，防抄袭对撞会话需三张表实际名全部相异 */
function findAllRenamedSeed(baseSession: ReturnType<typeof generateSession>, pack: ReturnType<typeof loadPackA>): number {
  const baseTableNames = baseSession.database.tables.map((t) => t.tableName);
  for (let seed = 1; seed <= 500; seed++) {
    const tableNames = generateSession(seed, pack).database.tables.map((t) => t.tableName);
    if (baseTableNames.every((name, i) => name !== tableNames[i])) return seed;
  }
  throw new Error("500 个种子内未出现全表名差异，候选池随机化失效");
}

describe("结构性防抄袭", () => {
  const pack = loadPackA();
  const sessionA = generateSession(20260101, pack);
  const sessionB = generateSession(findAllRenamedSeed(sessionA, pack), pack);

  it("前置：A 会话参考答案自判通过", { timeout: 30_000 }, async () => {
    for (const question of sessionA.questions) {
      expect((await judge(question.referenceAnswer, sessionA, question)).judge).toBe("通过");
    }
  });

  it("A 会话通过的 SQL 原文在 B 会话判定失败（列名不同）", async () => {
    for (let i = 0; i < sessionA.database.tables.length; i++) {
      expect(sessionA.database.tables[i].tableName).not.toBe(sessionB.database.tables[i].tableName);
    }
    // 全部模板均以实际表名/列名书写（中文标识符无点号限定），换会话即因表/列不存在而失败
    const columnRefQueries = sessionA.questions.map((q) => q.referenceAnswer);
    expect(columnRefQueries.length).toBeGreaterThan(0);
    const results = await Promise.all(
      columnRefQueries.map(async (sql, i) =>
        judge(sql, sessionB, sessionB.questions[i]),
      ),
    );
    for (const result of results) {
      expect(result.judge).not.toBe("通过"); // 表/列不存在 → 错误或不通过，绝不通过
    }
    // 至少一条因表/列不存在触发引擎错误（具体文案格式归 T2 管辖，此处不断言）
    expect(results.some((r) => r.judge === "错误")).toBe(true);
  });

  it("B 会话用自己的参考答案仍全部通过（随机化不破坏可作答性）", async () => {
    for (const question of sessionB.questions) {
      expect((await judge(question.referenceAnswer, sessionB, question)).judge).toBe("通过");
    }
  });
});
