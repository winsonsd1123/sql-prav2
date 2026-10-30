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

const 域包A: DomainPack = loadPackA();
const 会话 = generatePracticeSession(42, 域包A);
const 题目 = 会话.questions[0];

describe("执行查询：行数上限", () => {
  it("结果超限抛GuardLimitError（种类=行数上限，文案为产品提示）", async () => {
    // 域包A 种子42：三表 20×15×45 = 13500 行 > 上限
    const 三表 = 会话.database.tables.map((t) => t.tableName).join(", ");
    const 期望 = { kind: "行数上限", message: ROW_LIMIT_MESSAGE };
    await expect(executeQuery(`SELECT * FROM ${三表}`, 会话, RESULT_ROW_LIMIT)).rejects.toMatchObject(期望);
    await expect(executeQuery(`SELECT * FROM ${三表}`, 会话, RESULT_ROW_LIMIT)).rejects.toBeInstanceOf(GuardLimitError);
  });

  it("默认上限为 10000 行；未超限查询不受影响", async () => {
    expect(RESULT_ROW_LIMIT).toBe(10_000);
    const 结果 = await executeQuery(`SELECT * FROM ${会话.database.tables[0].tableName}`, 会话);
    expect(结果.rows.length).toBeGreaterThan(0);
  });

  it("上限可注入缩小：LIMIT 到上限内不再触发", async () => {
    const 表 = 会话.database.tables[0].tableName;
    const 结果 = await executeQuery(`SELECT * FROM ${表} LIMIT 10`, 会话, 20);
    expect(结果.rows.length).toBe(10);
    await expect(executeQuery(`SELECT * FROM ${表}`, 会话, 10)).rejects.toMatchObject({
      kind: "行数上限",
    });
  });
});

describe("判定：防护触发呈现为拦截（产品提示而非 MySQL 错误）", () => {
  it("学生 SQL 结果超限 → 拦截 + 产品提示", async () => {
    const 三表 = 会话.database.tables.map((t) => t.tableName).join(", ");
    const 结果 = await judge(`SELECT * FROM ${三表}`, 会话, 题目);
    expect(结果).toEqual({ judge: "拦截", errorMessage: ROW_LIMIT_MESSAGE });
  });

  it("参考答案超限（人为缩限）→ 同样拦截", async () => {
    const 结果 = await judge(`SELECT 1`, 会话, 题目, 3);
    expect(结果.judge).toBe("拦截");
  });
});
