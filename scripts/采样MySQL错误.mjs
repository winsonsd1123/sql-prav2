#!/usr/bin/env node
/**
 * MySQL 错误采样脚本（issue #3）：对故意写错的 SQL 集连本地 MySQL 采样，
 * 产出结构化夹具 src/kernel/__tests__/fixtures/mysql-error-fixtures.json。
 *
 * 凭据纪律：只从环境变量读取，绝不写入仓库。
 *   MYSQL_USER  默认 root
 *   MYSQL_PWD   必填
 *   MYSQL_HOST  默认 localhost（本机 socket）
 *
 * 用法：MYSQL_PWD=... node scripts/采样MySQL错误.mjs
 * 依赖 PATH 中的 mysql 客户端。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** 与域包A固定表名/列名一致的采样库（映射层产出的库名固定为 playground） */
const 建库SQL = [
  "CREATE DATABASE IF NOT EXISTS playground CHARACTER SET utf8mb4",
  "CREATE TABLE IF NOT EXISTS playground.学生 (学号 INTEGER, 姓名 TEXT, 性别 TEXT, 城市 TEXT, 奖学金 INTEGER)",
  "CREATE TABLE IF NOT EXISTS playground.课程 (课程号 INTEGER, 课程名 TEXT, 学分 INTEGER, 教师 TEXT)",
  "CREATE TABLE IF NOT EXISTS playground.成绩 (学号 INTEGER, 课程号 INTEGER, 分数 INTEGER)",
];

/** 故意写错的 SQL 集：类别 × 变体（供夹具回归逐项断言） */
const 样本集 = [
  // 1064 关键字拼错/结构残缺（near token 各不相同）
  { id: "1064-拼写-SELEC", 类别: "1064", sql: "SELEC * FROM 学生" },
  { id: "1064-拼写-FRO", 类别: "1064", sql: "SELECT 姓名 FRO 学生" },
  { id: "1064-拼写-FORM", 类别: "1064", sql: "SELECT * FORM 课程" },
  { id: "1064-残缺-缺左括号", 类别: "1064", sql: "SELECT COUNT 姓名) FROM 成绩" },
  { id: "1064-残缺-悬空逗号", 类别: "1064", sql: "SELECT 姓名, FROM 学生" },
  { id: "1064-拼写-WHER", 类别: "1064", sql: "SELECT * FROM 学生 WHER 性别 = '男'" },
  { id: "1064-字符串未闭合", 类别: "1064", sql: "SELECT * FROM 学生 WHERE 性别 = '男" },
  // 1146 表不存在
  { id: "1146-单表", 类别: "1146", sql: "SELECT * FROM 老师" },
  { id: "1146-别名表", 类别: "1146", sql: "SELECT * FROM 学生 s JOIN 班级 c ON s.学号 = c.学号" },
  { id: "1146-子查询", 类别: "1146", sql: "SELECT * FROM (SELECT * FROM 院系) t" },
  // 1054 列不存在
  { id: "1054-字段列表", 类别: "1054", sql: "SELECT 姓 FROM 学生" },
  { id: "1054-WHERE", 类别: "1054", sql: "SELECT * FROM 学生 WHERE 年龄 > 20" },
  { id: "1054-聚合参数", 类别: "1054", sql: "SELECT AVG(成绩) FROM 成绩" },
  { id: "1054-表前缀错列", 类别: "1054", sql: "SELECT 学生.名字 FROM 学生" },
  // 1055 ONLY_FULL_GROUP_BY：SELECT/ORDER BY 中非聚合非分组裸列
  // （样本只用"代入"后映射一致的角色列：姓名/城市/奖学金在实例库中同名或成对替换）
  { id: "1055-裸列", 类别: "1055", sql: "SELECT 姓名, COUNT(*) FROM 学生 GROUP BY 城市" },
  { id: "1055-表达式内", 类别: "1055", sql: "SELECT 奖学金 + 1 FROM 学生 GROUP BY 姓名" },
  { id: "1055-函数嵌列", 类别: "1055", sql: "SELECT CONCAT(姓名, 城市) FROM 学生 GROUP BY 姓名" },
  { id: "1055-别名表", 类别: "1055", sql: "SELECT s.姓名, COUNT(*) FROM 学生 s GROUP BY s.城市" },
  { id: "1055-序号表达式", 类别: "1055", sql: "SELECT COUNT(*), 城市 FROM 学生 GROUP BY 姓名" },
  { id: "1055-ORDER-BY", 类别: "1055", sql: "SELECT 姓名 FROM 学生 GROUP BY 姓名 ORDER BY 城市" },
  // 1305 函数不存在
  { id: "1305-SELECT列表", 类别: "1305", sql: "SELECT LEN(姓名) FROM 学生" },
  { id: "1305-WHERE", 类别: "1305", sql: "SELECT * FROM 成绩 WHERE SQUARE2(分数) > 100" },
  { id: "1305-聚合拼错", 类别: "1305", sql: "SELECT AVG2(分数) FROM 成绩" },
  // 1305 日期/字符串函数拼错（issue #5：转译层垫片函数的错误保真）
  { id: "1305-日期函数拼错", 类别: "1305", sql: "SELECT YEAR2(奖学金) FROM 学生" },
  { id: "1305-日期格式化拼错", 类别: "1305", sql: "SELECT DATE_FORMT(姓名, '%Y') FROM 学生" },
  { id: "1305-字符串拼接拼错", 类别: "1305", sql: "SELECT CONCAT2(姓名, 城市) FROM 学生" },
];

function 执行mysql(SQL, 库 = null) {
  const 参数 = [`-u${用户}`, `-h${主机}`, "--batch", "--raw"];
  if (库) 参数.push(库);
  const r = spawnSync("mysql", 参数, {
    input: SQL,
    env: { ...process.env, MYSQL_PWD: 密码 },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

// 建库
for (const sql of 建库SQL) {
  const r = 执行mysql(sql + ";");
  if (r.status !== 0) {
    console.error("建库失败：" + r.stderr);
    process.exit(1);
  }
}
const 版本 = 执行mysql("SELECT VERSION();").stdout.trim().split("\n").pop();

const 临时目录 = mkdtempSync(path.join(tmpdir(), "sql-sample-"));
const 样本 = [];
for (const { id, 类别, sql } of 样本集) {
  const 文件 = path.join(临时目录, "q.sql");
  writeFileSync(文件, sql + ";", "utf8");
  const r = spawnSync(
    "mysql",
    [`-u${用户}`, `-h${主机}`, "--batch", "--raw", "playground"],
    { input: sql + ";", env: { ...process.env, MYSQL_PWD: 密码 }, encoding: "utf8" },
  );
  const stderr = (r.stderr ?? "").trim();
  const m = stderr.match(/^ERROR (\d+) \((\w+)\)(?: at line (\d+))?: ([\s\S]*)$/);
  if (!m) {
    console.error(`样本 ${id} 未按预期报错：status=${r.status} stderr=${stderr} stdout=${r.stdout}`);
    process.exit(1);
  }
  const [, 码文本, sqlstate, , 文案] = m;
  const near = 文案.match(/near '([\s\S]*)' at line (\d+)\s*$/);
  样本.push({
    id,
    类别,
    sql,
    错误码: Number(码文本),
    sqlstate,
    文案,
    nearToken: near ? near[1] : null,
    行号: near ? Number(near[2]) : null,
  });
  console.log(`${id}\tERROR ${码文本} (${sqlstate})`);
}
rmSync(临时目录, { recursive: true, force: true });

const 夹具 = {
  说明: "MySQL 错误采样夹具（错误保真度验收基准）。由 scripts/采样MySQL错误.mjs 生成，勿手改。",
  采样环境: { 版本, 库名: "playground" },
  样本,
};
const 输出 = path.join(仓库根, "src/kernel/__tests__/fixtures/mysql-error-fixtures.json");
writeFileSync(输出, JSON.stringify(夹具, null, 2) + "\n", "utf8");
console.log(`已写入 ${path.relative(仓库根, 输出)}（${样本.length} 条样本，MySQL ${版本}）`);
