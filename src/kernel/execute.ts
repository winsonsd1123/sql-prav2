import type { 会话, 结果集, 显示值 } from "./types";
import { 注册垫片函数, 转译, type 垫片宿主 } from "./转译";
import { 行数上限提示, 防护超限错误 } from "./防护";

import type initSqlJs from "sql.js";

type 引擎 = Awaited<ReturnType<typeof initSqlJs>>;
type 数据库 = InstanceType<引擎["Database"]>;

let 已加载引擎: 引擎 | null = null;

/** sql.js 为 WASM 包，需动态加载；浏览器（主线程或 Worker，均无 Node fs）中 wasm 文件位于 public/ */
async function 加载引擎(): Promise<引擎> {
  if (!已加载引擎) {
    // Worker 全局无 window 但有 self；Node 测试环境两者皆无，走 sql.js 默认路径
    const 在浏览器 = typeof window !== "undefined" || typeof self !== "undefined";
    const init = (await import("sql.js")).default;
    已加载引擎 = await init(
      在浏览器 ? { locateFile: () => "/sql-wasm.wasm" } : {},
    );
  }
  return 已加载引擎;
}

/** 预热引擎：Worker 启动时立即加载 WASM，主线程据此展示首次加载指示 */
export async function 预热引擎(): Promise<void> {
  await 加载引擎();
}

/** 从会话库建立内存数据库（纯函数式：每次全新，执行不可变更会话） */
export async function 打开内存库(会话: 会话): Promise<数据库> {
  const SQL = await 加载引擎();
  const db = new SQL.Database();
  for (const 表 of 会话.库.表) {
    db.run(表.DDL);
    if (表.行.length === 0) continue;
    const 占位 = 表.行[0].map(() => "?").join(", ");
    const stmt = db.prepare(`INSERT INTO ${表.表名} VALUES (${占位})`);
    for (const 行 of 表.行) {
      stmt.run(行 as (string | number | null)[]);
    }
    stmt.free();
  }
  return db;
}

/** 按语句策略清洗：仅接受单条 SELECT，容忍单个尾分号；违规返回产品提示 */
export function 清洗语句(SQL文本: string): { ok: true; 语句: string } | { ok: false; 提示: string } {
  let 文本 = SQL文本.trim();
  if (文本.endsWith(";")) 文本 = 文本.slice(0, -1).trimEnd();
  if (文本.length === 0) return { ok: false, 提示: "演练场仅接受单条 SELECT 查询语句，请输入内容。" };
  if (文本.includes(";")) return { ok: false, 提示: "演练场仅接受单条 SELECT 查询语句，请勿一次提交多条语句。" };
  if (!/^select\b/i.test(文本)) return { ok: false, 提示: "演练场仅接受单条 SELECT 查询语句，INSERT/UPDATE/DELETE/DDL 均不在练习范围内。" };
  return { ok: true, 语句: 文本 };
}

/** 规范化为 MySQL 显示值：NULL 与空串严格区分、数值与字符串严格区分 */
function 规范化(v: unknown): 显示值 {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return `N:${v}`;
  if (typeof v === "bigint") return `N:${v}`;
  return `S:${String(v)}`;
}

/** 在内存库上执行查询，返回结果集；错误抛出 SQLite errmsg 原文（由错误映射层转 MySQL 三要素）。
 * 行数上限（issue #10）：结果超限时抛防护超限错误（产品提示），不进入 MySQL 错误映射。
 * 取舍：sql.js 的 exec 同步物化全部结果行，上限检查发生在物化之后——
 * 真正的内存/时间兜底由 Worker 超时终止负责，行数上限拦截"能跑完但结果巨大"的查询。 */
export async function 执行查询(
  语句: string,
  会话: 会话,
  行数上限?: number,
): Promise<结果集> {
  const db = await 打开内存库(会话);
  try {
    // 转译层（issue #5）：学生 SQL 为 MySQL 方言，垫片函数 + 语法改写对学生透明
    // （sql.js 类型声明缺 create_aggregate，垫片宿主为最小结构类型）
    注册垫片函数(db as unknown as 垫片宿主);
    const 结果 = db.exec(转译(语句));
    if (结果.length === 0) return { 列名: [], 行: [] };
    if (行数上限 !== undefined && 结果[0].values.length > 行数上限) {
      throw new 防护超限错误("行数上限", 行数上限提示);
    }
    return {
      列名: 结果[0].columns,
      行: 结果[0].values.map((行) => 行.map(规范化)),
    };
  } finally {
    db.close();
  }
}

/** UI 展示用的显示文本（去掉类型标记） */
export function 显示(v: 显示值): string {
  return v === null ? "NULL" : v.slice(2);
}
