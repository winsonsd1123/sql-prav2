import { describe, expect, it } from "vitest";
import { generatePracticeSession } from "@/kernel/question-picking";
import { judge } from "@/kernel/judge";
import { executeQuery } from "@/kernel/execute";
import { RESULT_ROW_LIMIT, GuardLimitError, ROW_LIMIT_MESSAGE } from "@/kernel/guard";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";
import type { DomainPack } from "@/kernel/types";

/**
 * 大查询防护（issue #10 / T9）：
 * 执行超时由 Worker 终止兜底（主线程逻辑，浏览器专属，e2e 覆盖）；
 * 此处覆盖内核侧行数上限：结果超限 → GuardLimitError / 判定拦截（产品提示，
 * 不进入 MySQL 错误三要素映射）。
 */

const packA: DomainPack = loadPackA();
const session = generatePracticeSession(42, packA);
const question = session.questions[0];

describe("执行查询：行数上限", () => {
  it("结果超限抛GuardLimitError（种类=行数上限，文案为产品提示）", async () => {
    // packA 种子42：allTables 20×15×45 = 13500 行 > 上限
    const allTables = session.database.tables.map((t) => t.tableName).join(", ");
    const expected = { kind: "行数上限", message: ROW_LIMIT_MESSAGE };
    await expect(executeQuery(`SELECT * FROM ${allTables}`, session, RESULT_ROW_LIMIT)).rejects.toMatchObject(expected);
    await expect(executeQuery(`SELECT * FROM ${allTables}`, session, RESULT_ROW_LIMIT)).rejects.toBeInstanceOf(GuardLimitError);
  });

  it("默认上限为 10000 行；未超限查询不受影响", async () => {
    expect(RESULT_ROW_LIMIT).toBe(10_000);
    const result = await executeQuery(`SELECT * FROM ${session.database.tables[0].tableName}`, session);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("上限可注入缩小：LIMIT 到上限内不再触发", async () => {
    const tableName = session.database.tables[0].tableName;
    const result = await executeQuery(`SELECT * FROM ${tableName} LIMIT 10`, session, 20);
    expect(result.rows.length).toBe(10);
    await expect(executeQuery(`SELECT * FROM ${tableName}`, session, 10)).rejects.toMatchObject({
      kind: "行数上限",
    });
  });
});

describe("判定：防护触发呈现为拦截（产品提示而非 MySQL wrongSql）", () => {
  it("学生 SQL 结果超限 → 拦截 + 产品提示", async () => {
    const allTables = session.database.tables.map((t) => t.tableName).join(", ");
    const result = await judge(`SELECT * FROM ${allTables}`, session, question);
    expect(result).toEqual({ judge: "拦截", errorMessage: ROW_LIMIT_MESSAGE });
  });

  it("参考答案超限（人为缩限）→ 同样拦截", async () => {
    const result = await judge(`SELECT 1`, session, question, 3);
    expect(result.judge).toBe("拦截");
  });
});
