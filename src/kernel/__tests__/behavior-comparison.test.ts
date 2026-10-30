import { describe, it, expect } from "vitest";
import behaviorFixtureJson from "./fixtures/mysql-behavior-fixtures.json";
import type { Session, TableInstance, QuestionInstance } from "../types";
import { executeQuery, formatValue } from "../execute";
import { judge } from "../judge";

/**
 * 转译层行为对照（T4 验收基准，issue #5）：
 * 样本集先在真实 MySQL 26.7 上执行、结果固化入 mysql-behavior-fixtures.json；
 * 同一批 SQL 经判题内核（转译 + sql.js）执行后逐值断言一致。
 * 学生写的是 MySQL 方言（SEPARATOR 等），转译须对学生透明。
 */
const fixture = behaviorFixtureJson as {
  样本: { id: string; sql: string; 列名: string[]; 行: (string | null)[][] }[];
};

/** 与采样库 playground.员工 完全一致的固定会话（双侧数据同源） */
const employeeTable: TableInstance = {
  tableName: "员工",
  columnNames: ["工号", "姓名", "部门", "入职日期", "奖金"],
  types: ["INTEGER", "TEXT", "TEXT", "TEXT", "INTEGER"],
  DDL: "CREATE TABLE 员工 (工号 INTEGER, 姓名 TEXT, 部门 TEXT, 入职日期 TEXT, 奖金 INTEGER)",
  rows: [
    [1, "张伟", "技术部", "2021-07-15", 3000],
    [2, "李娜", "人事部", "2022-03-01", null],
    [3, "王强", "技术部", "2020-11-30", 1500],
    [4, "刘洋", "市场部", "2023-01-05", 0],
    [5, "陈静", "技术部", "2019-06-20", 5000],
    [6, "赵敏", null, "2024-02-29", 8000],
    [7, "孙磊", "", "2022-12-31", null],
  ],
};

function fixedSession(): Session {
  return {
    seed: 0,
    packId: "behavior-fixture",
    database: { tables: [employeeTable] },
    questions: [],
  };
}

describe("转译层行为对照（MySQL 采样基准）", () => {
  for (const sample of fixture.样本) {
    it(`${sample.id}：${sample.sql}`, async () => {
      const result = await executeQuery(sample.sql, fixedSession());
      const actualRows = result.rows.map((row) => row.map((cell) => (cell === null ? null : formatValue(cell))));
      expect(actualRows).toEqual(sample.行);
    });
  }
});

describe("NOW 族非确定函数（形状与相互关系）", () => {
  it("NOW/CURDATE/CURTIME 返回 MySQL 格式且相互一致", async () => {
    const session = fixedSession();
    const now = (await executeQuery("SELECT NOW()", session)).rows[0][0];
    const curdate = (await executeQuery("SELECT CURDATE()", session)).rows[0][0];
    const curtime = (await executeQuery("SELECT CURTIME()", session)).rows[0][0];
    expect(now).toMatch(/^S:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(curdate).toBe(now!.slice(0, 10 + 2)); // CURDATE = NOW 的日期部分（含 S: 前缀）
    expect(curtime).toBe("S:" + now!.slice(13)); // CURTIME = NOW 的时间部分（跳过日期与空格）
  });

  it("DATE_FORMAT 与 NOW 组合可用", async () => {
    const result = await executeQuery(
      "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d')",
      fixedSession(),
    );
    expect(result.rows[0][0]).toMatch(/^S:\d{4}-\d{2}-\d{2}$/);
  });

  it("同一查询内多次 NOW() 取值一致（MySQL 语句级一致语义）", async () => {
    const result = await executeQuery(
      "SELECT DATEDIFF(NOW(), NOW()), NOW() = NOW()",
      fixedSession(),
    );
    expect(result.rows[0]).toEqual(["N:0", "N:1"]);
  });
});

describe("含日期函数的示例题端到端判题", () => {
  it("学生用 MySQL 方言作答日期格式化题 → 判定通过", async () => {
    const session = fixedSession();
    const question: QuestionInstance = {
      templateId: "示例-入职年份",
      knowledgeArea: "日期函数",
      difficulty: 2,
      prompt: "查询每位员工的姓名与入职年份（四位数）。",
      hints: ["YEAR 函数可提取年份", "参考 DATE_FORMAT"],
      referenceAnswer: "SELECT 姓名, YEAR(入职日期) FROM 员工 ORDER BY 工号",
      ordered: true,
    };
    // 学生写法与参考答案不同路数（CONCAT 拼接 + DATE_FORMAT 提取）：
    // 日期与字符串垫片同题生效，结果集等价即通过
    const studentSql = `SELECT 姓名, CAST(SUBSTR(DATE_FORMAT(入职日期, '%Y年'), 1, 4) AS INTEGER) FROM 员工 ORDER BY 工号`;
    const result = await judge(studentSql, session, question);
    expect(result).toEqual({ judge: "通过" });
  });

  it("结果不等价时不通过（防通过判定空转）", async () => {
    const session = fixedSession();
    const question: QuestionInstance = {
      templateId: "示例-入职年份",
      knowledgeArea: "日期函数",
      difficulty: 2,
      prompt: "查询每位员工的姓名与入职年份（四位数）。",
      hints: ["YEAR 函数可提取年份", "参考 DATE_FORMAT"],
      referenceAnswer: "SELECT 姓名, YEAR(入职日期) FROM 员工 ORDER BY 工号",
      ordered: true,
    };
    const result = await judge(
      "SELECT 姓名, MONTH(入职日期) FROM 员工 ORDER BY 工号",
      session,
      question,
    );
    expect(result.judge).toBe("不通过");
  });
});

describe("边界样本（code-review #1 追加；已入采样脚本样本集，待下次采样固化入夹具）", () => {
  it("DATEDIFF 只按日期部分求差，忽略时间部分", async () => {
    const result = await executeQuery(
      "SELECT DATEDIFF('2024-03-01 23:59:59','2024-02-01 00:00:01'), DATEDIFF('2024-03-01','2024-03-01 12:00:00')",
      fixedSession(),
    );
    expect(result.rows[0]).toEqual(["N:29", "N:0"]);
  });

  it("DATE_FORMAT 的 %T/%f/%p/%h 说明符", async () => {
    const result = await executeQuery(
      "SELECT DATE_FORMAT('2024-03-15 14:05:09','%T %f'), DATE_FORMAT('2024-03-15 00:30:00','%p %h')",
      fixedSession(),
    );
    expect(result.rows[0]).toEqual(["S:14:05:09 000000", "S:AM 12"]);
  });

  it("CONCAT_WS 跳过 NULL 参数、分隔符 NULL 则整体 NULL", async () => {
    const result = await executeQuery(
      "SELECT CONCAT_WS('-',姓名,NULL,NULL), CONCAT_WS(NULL,'a','b') FROM 员工 ORDER BY 工号 LIMIT 3",
      fixedSession(),
    );
    expect(result.rows).toEqual([["S:张伟", null], ["S:李娜", null], ["S:王强", null]]);
  });

  it("年月日边界：闰日与年末年末日期", async () => {
    const result = await executeQuery(
      "SELECT YEAR('2024-02-29'), MONTH('2024-12-31'), DAY('2024-01-31'), DATE('2024-02-29 23:59:59')",
      fixedSession(),
    );
    expect(result.rows[0]).toEqual(["N:2024", "N:12", "N:31", "S:2024-02-29"]);
  });
});
