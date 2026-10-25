import { describe, expect, it } from "vitest";
import { 生成练习会话 } from "@/kernel/出题";
import { 判定 } from "@/kernel/judge";
import { 执行查询 } from "@/kernel/execute";
import { 结果行数上限, 防护超限错误, 行数上限提示 } from "@/kernel/防护";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";
import type { 域包 } from "@/kernel/types";

/**
 * 大查询防护（issue #10 / T9）：
 * 执行超时由 Worker 终止兜底（主线程逻辑，浏览器专属，e2e 覆盖）；
 * 此处覆盖内核侧行数上限：结果超限 → 防护超限错误 / 判定拦截（产品提示，
 * 不进入 MySQL 错误三要素映射）。
 */

const 域包A: 域包 = 加载域包A();
const 会话 = 生成练习会话(42, 域包A);
const 题目 = 会话.题目[0];

describe("执行查询：行数上限", () => {
  it("结果超限抛防护超限错误（种类=行数上限，文案为产品提示）", async () => {
    // 域包A 种子42：三表 20×15×45 = 13500 行 > 上限
    const 三表 = 会话.库.表.map((t) => t.表名).join(", ");
    const 期望 = { 种类: "行数上限", message: 行数上限提示 };
    await expect(执行查询(`SELECT * FROM ${三表}`, 会话, 结果行数上限)).rejects.toMatchObject(期望);
    await expect(执行查询(`SELECT * FROM ${三表}`, 会话, 结果行数上限)).rejects.toBeInstanceOf(防护超限错误);
  });

  it("默认上限为 10000 行；未超限查询不受影响", async () => {
    expect(结果行数上限).toBe(10_000);
    const 结果 = await 执行查询(`SELECT * FROM ${会话.库.表[0].表名}`, 会话);
    expect(结果.行.length).toBeGreaterThan(0);
  });

  it("上限可注入缩小：LIMIT 到上限内不再触发", async () => {
    const 表 = 会话.库.表[0].表名;
    const 结果 = await 执行查询(`SELECT * FROM ${表} LIMIT 10`, 会话, 20);
    expect(结果.行.length).toBe(10);
    await expect(执行查询(`SELECT * FROM ${表}`, 会话, 10)).rejects.toMatchObject({
      种类: "行数上限",
    });
  });
});

describe("判定：防护触发呈现为拦截（产品提示而非 MySQL 错误）", () => {
  it("学生 SQL 结果超限 → 拦截 + 产品提示", async () => {
    const 三表 = 会话.库.表.map((t) => t.表名).join(", ");
    const 结果 = await 判定(`SELECT * FROM ${三表}`, 会话, 题目);
    expect(结果).toEqual({ 判定: "拦截", 错误信息: 行数上限提示 });
  });

  it("参考答案超限（人为缩限）→ 同样拦截", async () => {
    const 结果 = await 判定(`SELECT 1`, 会话, 题目, 3);
    expect(结果.判定).toBe("拦截");
  });
});
