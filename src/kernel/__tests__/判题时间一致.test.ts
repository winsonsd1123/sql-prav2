import { describe, expect, it } from "vitest";
import { 生成 } from "@/kernel/generate";
import { 判定 } from "@/kernel/judge";
import { 执行查询 } from "@/kernel/execute";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";
import type { 题目实例 } from "@/kernel/types";

/**
 * NOW/CURDATE 判题级一致性（code-review #1）：
 * 同一次判定中，学生 SQL 与参考答案的两次执行必须共享同一时刻，
 * 否则毫秒/秒边界抖动可致"学生逐字照抄参考答案仍误判不通过"。
 */

const 会话 = 生成(20260101, 加载域包A());

/** 本地时区固定时刻：2020-01-01 12:00:00（垫片 NOW 用本地时间字段拼接） */
const 固定时刻 = new Date(2020, 0, 1, 12, 34, 56);
const 固定文本 = "2020-01-01 12:34:56";

/** 用含 NOW() 的自定义题替换实例题，参考答案用固定时刻字面量钉死预期 */
function 时刻题(): 题目实例 {
  const 原 = 会话.题目[0];
  return { ...原, 参考答案: `SELECT '${固定文本}' AS 当前时刻`, ordered: false };
}

describe("NOW/CURDATE 判题级一致性", () => {
  it("执行查询接受判定级时刻，NOW()/CURDATE() 取该时刻", async () => {
    const 结果 = await 执行查询("SELECT NOW() AS n, CURDATE() AS d", 会话, undefined, 固定时刻);
    expect(结果.行).toEqual([[`S:${固定文本}`, `S:${固定文本.slice(0, 10)}`]]);
  });

  it("同一判定内学生 SQL 与参考答案共享同一时刻（学生逐字含 NOW() 也确定性通过）", async () => {
    const 题目 = 时刻题();
    const 结果 = await 判定("SELECT NOW() AS 当前时刻", 会话, 题目, undefined, 固定时刻);
    expect(结果).toEqual({ 判定: "通过" });
  });

  it("两次独立判定（相同学生 SQL 与参考答案，均含 NOW()）结果确定性一致", async () => {
    const 题目 = { ...时刻题(), 参考答案: "SELECT NOW() AS 当前时刻" };
    const 第一次 = await 判定("SELECT NOW() AS 当前时刻", 会话, 题目, undefined, 固定时刻);
    const 第二次 = await 判定("SELECT NOW() AS 当前时刻", 会话, 题目, undefined, new Date(2021, 5, 15, 8, 0, 0));
    expect(第一次).toEqual({ 判定: "通过" });
    expect(第二次).toEqual({ 判定: "通过" });
  });
});
