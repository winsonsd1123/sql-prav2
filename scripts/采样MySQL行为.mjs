#!/usr/bin/env node
/**
 * MySQL 日期/字符串函数行为采样脚本（issue #5）：在真实 MySQL 上执行行为样本集，
 * 采回期望结果，产出 src/kernel/__tests__/fixtures/mysql-behavior-fixtures.json，
 * 作为转译层行为对照测试（T4）的验收基准——等价于日期版的错误夹具。
 *
 * 凭据纪律：只从环境变量读取，绝不写入仓库。
 *   MYSQL_USER  默认 root
 *   MYSQL_PWD   必填
 *   MYSQL_HOST  默认 localhost（本机 socket）
 *
 * 用法：MYSQL_PWD=... node scripts/采样MySQL行为.mjs
 * 依赖 PATH 中的 mysql 客户端。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 用户 = process.env.MYSQL_USER ?? "root";
const 密码 = process.env.MYSQL_PWD;
const 主机 = process.env.MYSQL_HOST ?? "localhost";
if (!密码) {
  console.error("缺少 MYSQL_PWD 环境变量（凭据不进仓库，只在进程环境传递）");
  process.exit(1);
}

const 仓库根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 行为采样库：员工表（含日期列、NULL、空串素材）。
 * 该表同时以固定 DDL + 固定行固化进行为对照测试的会话，双侧数据一致。
 */
const 建库SQL = [
  "CREATE DATABASE IF NOT EXISTS playground CHARACTER SET utf8mb4",
  "DROP TABLE IF EXISTS playground.员工",
  `CREATE TABLE playground.员工 (
     工号 INTEGER, 姓名 TEXT, 部门 TEXT, 入职日期 TEXT, 奖金 INTEGER
   )`,
  `INSERT INTO playground.员工 VALUES
     (1,'张伟','技术部','2021-07-15',3000),
     (2,'李娜','人事部','2022-03-01',NULL),
     (3,'王强','技术部','2020-11-30',1500),
     (4,'刘洋','市场部','2023-01-05',0),
     (5,'陈静','技术部','2019-06-20',5000),
     (6,'赵敏',NULL,'2024-02-29',8000),
     (7,'孙磊','','2022-12-31',NULL)`,
];

/**
 * 行为样本集：确定性查询（NOW/CURDATE/CURTIME 等非确定函数不入夹具，
 * 由测试断言形状与相互关系）。GROUP_CONCAT 经有序子查询保证组内顺序确定。
 */
const 样本集 = [
  { id: "日期-标量", sql: "SELECT YEAR('2024-03-15'), MONTH('2024-03-15'), DAY('2024-03-15'), DATE('2024-03-15 14:05:09'), DATEDIFF('2024-03-01','2024-02-01'), DATEDIFF('2024-02-01','2024-03-01')" },
  { id: "日期-标量-NULL", sql: "SELECT YEAR(NULL), DATE_FORMAT(NULL,'%Y'), DATEDIFF(NULL,'2024-01-01')" },
  { id: "DATE_FORMAT-中文", sql: "SELECT DATE_FORMAT('2024-03-15 14:05:09','%Y年%m月%d日 %H:%i:%s')" },
  { id: "DATE_FORMAT-变体", sql: "SELECT DATE_FORMAT('2024-03-15 14:05:09','%y-%c-%e %k:%s %p %h')" },
  { id: "DATE_FORMAT-英文月周", sql: "SELECT DATE_FORMAT('2024-03-15','%W %M %b %a %j')" },
  { id: "DATE_FORMAT-列", sql: "SELECT 姓名, DATE_FORMAT(入职日期,'%Y年%m月') FROM 员工 ORDER BY 工号" },
  { id: "年月日-列", sql: "SELECT 姓名, YEAR(入职日期), MONTH(入职日期), DAY(入职日期) FROM 员工 ORDER BY 工号" },
  { id: "DATEDIFF-列", sql: "SELECT 姓名, DATEDIFF('2025-01-10', 入职日期) FROM 员工 ORDER BY 工号" },
  { id: "CONCAT-列", sql: "SELECT CONCAT(姓名,'/',部门) FROM 员工 ORDER BY 工号" },
  { id: "CONCAT-数字与NULL", sql: "SELECT CONCAT(工号,'号-',姓名), CONCAT(姓名,NULL) FROM 员工 ORDER BY 工号 LIMIT 3" },
  { id: "CONCAT_WS-跳过NULL", sql: "SELECT CONCAT_WS('-',姓名,部门) FROM 员工 ORDER BY 工号" },
  { id: "GROUP_CONCAT-默认分隔", sql: "SELECT GROUP_CONCAT(姓名 SEPARATOR ',') FROM (SELECT 工号,姓名 FROM 员工 ORDER BY 工号 LIMIT 100) t" },
  { id: "GROUP_CONCAT-自定义分隔", sql: "SELECT GROUP_CONCAT(姓名 SEPARATOR ' | ') FROM (SELECT 工号,姓名 FROM 员工 ORDER BY 工号 DESC LIMIT 100) t" },
  { id: "GROUP_CONCAT-分组", sql: "SELECT 部门, GROUP_CONCAT(姓名 SEPARATOR '/') FROM (SELECT 工号,部门,姓名 FROM 员工 ORDER BY 工号 LIMIT 100) t GROUP BY 部门 ORDER BY 部门" },
  { id: "GROUP_CONCAT-DISTINCT", sql: "SELECT GROUP_CONCAT(DISTINCT 部门 SEPARATOR ',') FROM (SELECT 部门 FROM 员工 WHERE 部门 IS NOT NULL ORDER BY 部门 LIMIT 100) t" },
  // 边界样本（code-review #1 追加：均为垫片已实现函数的新边界值；DATE_ADD/DATE_SUB 垫片未实现，不入样本）
  { id: "DATEDIFF-含时间部分", sql: "SELECT DATEDIFF('2024-03-01 23:59:59','2024-02-01 00:00:01'), DATEDIFF('2024-03-01','2024-03-01 12:00:00')" },
  { id: "DATE_FORMAT-T与f", sql: "SELECT DATE_FORMAT('2024-03-15 14:05:09','%T %f'), DATE_FORMAT('2024-03-15 00:30:00','%p %h')" },
  { id: "CONCAT_WS-空参数与NULL分隔", sql: "SELECT CONCAT_WS('-',姓名,NULL,NULL), CONCAT_WS(NULL,'a','b') FROM 员工 ORDER BY 工号 LIMIT 3" },
  { id: "年月日-边界日期", sql: "SELECT YEAR('2024-02-29'), MONTH('2024-12-31'), DAY('2024-01-31'), DATE('2024-02-29 23:59:59')" },
];

function 执行mysql(SQL) {
  const r = spawnSync(
    "mysql",
    [`-u${用户}`, `-h${主机}`, "--batch", "--raw", "playground"],
    { input: SQL + ";", env: { ...process.env, MYSQL_PWD: 密码 }, encoding: "utf8" },
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

for (const sql of 建库SQL) {
  const r = 执行mysql(sql);
  if (r.status !== 0) {
    console.error("建库失败：" + r.stderr);
    process.exit(1);
  }
}
const 版本 = 执行mysql("SELECT VERSION();").stdout.trim().split("\n").pop();

const 样本 = [];
for (const { id, sql } of 样本集) {
  const r = 执行mysql(sql);
  if (r.status !== 0) {
    console.error(`样本 ${id} 执行失败：${r.stderr.trim()}`);
    process.exit(1);
  }
  // --batch --raw：首行为制表符分隔列名，其后每行一记录，NULL 字面量保留
  const 行 = r.stdout.split("\n").filter((l) => l !== "");
  const 列名 = 行[0].split("\t");
  const 数据行 = 行.slice(1).map((l) => l.split("\t").map((c) => (c === "NULL" ? null : c)));
  样本.push({ id, sql, 列名, 行: 数据行 });
  console.log(`${id}\t${数据行.length} 行`);
}

const 夹具 = {
  说明: "MySQL 日期/字符串函数行为采样夹具（转译层验收基准，issue #5）。由 scripts/采样MySQL行为.mjs 生成，勿手改。",
  采样环境: { 版本, 库名: "playground", 表: "员工（固定 7 行，与行为对照测试会话一致）" },
  样本,
};
const 输出 = path.join(仓库根, "src/kernel/__tests__/fixtures/mysql-behavior-fixtures.json");
writeFileSync(输出, JSON.stringify(夹具, null, 2) + "\n", "utf8");
console.log(`已写入 ${path.relative(仓库根, 输出)}（${样本.length} 条样本，MySQL ${版本}）`);
