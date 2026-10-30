import { describe, expect, it } from "vitest";
import { generateSession } from "@/kernel/generate";
import { judge } from "@/kernel/judge";
import { executeQuery } from "@/kernel/execute";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";
import type { QuestionInstance } from "@/kernel/types";

/**
 * NOW/CURDATE 判题级一致性（code-review #1）：
 * 同一次判定中，学生 SQL 与参考答案的两次执行必须共享同一时刻，
 * 否则毫秒/秒边界抖动可致"学生逐字照抄参考答案仍误判不通过"。
 */

const session = generateSession(20260101, loadPackA());

/** 本地时区固定时刻：2020-01-01 12:00:00（垫片 NOW 用本地时间字段拼接） */
const fixedTime = new Date(2020, 0, 1, 12, 34, 56);
const fixedText = "2020-01-01 12:34:56";

/** 用含 NOW() 的自定义题替换实例题，参考答案用固定时刻字面量钉死预期 */
function timeQuestion(): QuestionInstance {
  const original = session.questions[0];
  return { ...original, referenceAnswer: `SELECT '${fixedText}' AS 当前时刻`, ordered: false };
}

describe("NOW/CURDATE 判题级一致性", () => {
  it("执行查询接受判定级时刻，NOW()/CURDATE() 取该时刻", async () => {
    const result = await executeQuery("SELECT NOW() AS n, CURDATE() AS d", session, undefined, fixedTime);
    expect(result.rows).toEqual([[`S:${fixedText}`, `S:${fixedText.slice(0, 10)}`]]);
  });

  it("同一判定内学生 SQL 与参考答案共享同一时刻（学生逐字含 NOW() 也确定性通过）", async () => {
    const question = timeQuestion();
    const result = await judge("SELECT NOW() AS 当前时刻", session, question, undefined, fixedTime);
    expect(result).toEqual({ judge: "通过" });
  });

  it("两次独立判定（相同学生 SQL 与参考答案，均含 NOW()）结果确定性一致", async () => {
    const question = { ...timeQuestion(), referenceAnswer: "SELECT NOW() AS 当前时刻" };
    const first = await judge("SELECT NOW() AS 当前时刻", session, question, undefined, fixedTime);
    const second = await judge("SELECT NOW() AS 当前时刻", session, question, undefined, new Date(2021, 5, 15, 8, 0, 0));
    expect(first).toEqual({ judge: "通过" });
    expect(second).toEqual({ judge: "通过" });
  });
});
