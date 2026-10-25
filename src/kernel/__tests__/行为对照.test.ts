import { describe, it, expect } from "vitest";
import 行为夹具JSON from "./fixtures/MySQL行为夹具.json";
import type { 会话, 表实例, 题目实例 } from "../types";
import { 执行查询, 显示 } from "../execute";
import { 判定 } from "../judge";

/**
 * 转译层行为对照（T4 验收基准，issue #5）：
 * 样本集先在真实 MySQL 26.7 上执行、结果固化入 MySQL行为夹具.json；
 * 同一批 SQL 经判题内核（转译 + sql.js）执行后逐值断言一致。
 * 学生写的是 MySQL 方言（SEPARATOR 等），转译须对学生透明。
 */
const 夹具 = 行为夹具JSON as {
  样本: { id: string; sql: string; 列名: string[]; 行: (string | null)[][] }[];
};

/** 与采样库 playground.员工 完全一致的固定会话（双侧数据同源） */
const 员工表: 表实例 = {
  表名: "员工",
  列名: ["工号", "姓名", "部门", "入职日期", "奖金"],
  类型: ["INTEGER", "TEXT", "TEXT", "TEXT", "INTEGER"],
  DDL: "CREATE TABLE 员工 (工号 INTEGER, 姓名 TEXT, 部门 TEXT, 入职日期 TEXT, 奖金 INTEGER)",
  行: [
    [1, "张伟", "技术部", "2021-07-15", 3000],
    [2, "李娜", "人事部", "2022-03-01", null],
    [3, "王强", "技术部", "2020-11-30", 1500],
    [4, "刘洋", "市场部", "2023-01-05", 0],
    [5, "陈静", "技术部", "2019-06-20", 5000],
    [6, "赵敏", null, "2024-02-29", 8000],
    [7, "孙磊", "", "2022-12-31", null],
  ],
};

function 固定会话(): 会话 {
  return {
    种子: 0,
    域包ID: "behavior-fixture",
    库: { 表: [员工表] },
    题目: [],
  };
}

describe("转译层行为对照（MySQL 采样基准）", () => {
  for (const 样本 of 夹具.样本) {
    it(`${样本.id}：${样本.sql}`, async () => {
      const 结果 = await 执行查询(样本.sql, 固定会话());
      const 实际 = 结果.行.map((行) => 行.map((格) => (格 === null ? null : 显示(格))));
      expect(实际).toEqual(样本.行);
    });
  }
});

describe("NOW 族非确定函数（形状与相互关系）", () => {
  it("NOW/CURDATE/CURTIME 返回 MySQL 格式且相互一致", async () => {
    const 会话 = 固定会话();
    const now = (await 执行查询("SELECT NOW()", 会话)).行[0][0];
    const curdate = (await 执行查询("SELECT CURDATE()", 会话)).行[0][0];
    const curtime = (await 执行查询("SELECT CURTIME()", 会话)).行[0][0];
    expect(now).toMatch(/^S:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(curdate).toBe(now!.slice(0, 10 + 2)); // CURDATE = NOW 的日期部分（含 S: 前缀）
    expect(curtime).toBe("S:" + now!.slice(13)); // CURTIME = NOW 的时间部分（跳过日期与空格）
  });

  it("DATE_FORMAT 与 NOW 组合可用", async () => {
    const 结果 = await 执行查询(
      "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d')",
      固定会话(),
    );
    expect(结果.行[0][0]).toMatch(/^S:\d{4}-\d{2}-\d{2}$/);
  });

  it("同一查询内多次 NOW() 取值一致（MySQL 语句级一致语义）", async () => {
    const 结果 = await 执行查询(
      "SELECT DATEDIFF(NOW(), NOW()), NOW() = NOW()",
      固定会话(),
    );
    expect(结果.行[0]).toEqual(["N:0", "N:1"]);
  });
});

describe("含日期函数的示例题端到端判题", () => {
  it("学生用 MySQL 方言作答日期格式化题 → 判定通过", async () => {
    const 会话 = 固定会话();
    const 题目: 题目实例 = {
      模板ID: "示例-入职年份",
      知识点: "日期函数",
      难度: 2,
      题面: "查询每位员工的姓名与入职年份（四位数）。",
      提示: ["YEAR 函数可提取年份", "参考 DATE_FORMAT"],
      参考答案: "SELECT 姓名, YEAR(入职日期) FROM 员工 ORDER BY 工号",
      ordered: true,
    };
    // 学生写法与参考答案不同路数（CONCAT 拼接 + DATE_FORMAT 提取）：
    // 日期与字符串垫片同题生效，结果集等价即通过
    const 学生SQL = `SELECT 姓名, CAST(SUBSTR(DATE_FORMAT(入职日期, '%Y年'), 1, 4) AS INTEGER) FROM 员工 ORDER BY 工号`;
    const 结果 = await 判定(学生SQL, 会话, 题目);
    expect(结果).toEqual({ 判定: "通过" });
  });

  it("结果不等价时不通过（防通过判定空转）", async () => {
    const 会话 = 固定会话();
    const 题目: 题目实例 = {
      模板ID: "示例-入职年份",
      知识点: "日期函数",
      难度: 2,
      题面: "查询每位员工的姓名与入职年份（四位数）。",
      提示: ["YEAR 函数可提取年份", "参考 DATE_FORMAT"],
      参考答案: "SELECT 姓名, YEAR(入职日期) FROM 员工 ORDER BY 工号",
      ordered: true,
    };
    const 结果 = await 判定(
      "SELECT 姓名, MONTH(入职日期) FROM 员工 ORDER BY 工号",
      会话,
      题目,
    );
    expect(结果.判定).toBe("不通过");
  });
});

describe("边界样本（code-review #1 追加；已入采样脚本样本集，待下次采样固化入夹具）", () => {
  it("DATEDIFF 只按日期部分求差，忽略时间部分", async () => {
    const 结果 = await 执行查询(
      "SELECT DATEDIFF('2024-03-01 23:59:59','2024-02-01 00:00:01'), DATEDIFF('2024-03-01','2024-03-01 12:00:00')",
      固定会话(),
    );
    expect(结果.行[0]).toEqual(["N:29", "N:0"]);
  });

  it("DATE_FORMAT 的 %T/%f/%p/%h 说明符", async () => {
    const 结果 = await 执行查询(
      "SELECT DATE_FORMAT('2024-03-15 14:05:09','%T %f'), DATE_FORMAT('2024-03-15 00:30:00','%p %h')",
      固定会话(),
    );
    expect(结果.行[0]).toEqual(["S:14:05:09 000000", "S:AM 12"]);
  });

  it("CONCAT_WS 跳过 NULL 参数、分隔符 NULL 则整体 NULL", async () => {
    const 结果 = await 执行查询(
      "SELECT CONCAT_WS('-',姓名,NULL,NULL), CONCAT_WS(NULL,'a','b') FROM 员工 ORDER BY 工号 LIMIT 3",
      固定会话(),
    );
    expect(结果.行).toEqual([["S:张伟", null], ["S:李娜", null], ["S:王强", null]]);
  });

  it("年月日边界：闰日与年末年末日期", async () => {
    const 结果 = await 执行查询(
      "SELECT YEAR('2024-02-29'), MONTH('2024-12-31'), DAY('2024-01-31'), DATE('2024-02-29 23:59:59')",
      固定会话(),
    );
    expect(结果.行[0]).toEqual(["N:2024", "N:12", "N:31", "S:2024-02-29"]);
  });
});
