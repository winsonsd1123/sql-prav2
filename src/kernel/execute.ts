import type { Session, ResultSet, DisplayValue } from "./types";
import { registerShimFunctions, translateSql, type ShimHost } from "./sql-translate";
import { ROW_LIMIT_MESSAGE, GuardLimitError } from "./guard";

import type initSqlJs from "sql.js";

type Engine = Awaited<ReturnType<typeof initSqlJs>>;
type Database = InstanceType<Engine["Database"]>;

let loadedEngine: Engine | null = null;

/** sql.js 为 WASM 包，需动态加载；浏览器（主线程或 Worker，均无 Node fs）中 wasm 文件位于 public/ */
async function loadEngine(): Promise<Engine> {
  if (!loadedEngine) {
    // Worker 全局无 window 但有 self；Node 测试环境两者皆无，走 sql.js 默认路径
    const isBrowser = typeof window !== "undefined" || typeof self !== "undefined";
    const init = (await import("sql.js")).default;
    loadedEngine = await init(
      isBrowser ? { locateFile: () => "/sql-wasm.wasm" } : {},
    );
  }
  return loadedEngine;
}

/** 预热引擎：Worker 启动时立即加载 WASM，主线程据此展示首次加载指示 */
export async function warmUpEngine(): Promise<void> {
  await loadEngine();
}

/** 从会话库建立内存数据库（纯函数式：每次全新，执行不可变更会话） */
export async function openInMemoryDb(session: Session): Promise<Database> {
  const SQL = await loadEngine();
  const db = new SQL.Database();
  for (const table of session.database.tables) {
    db.run(table.DDL);
    if (table.rows.length === 0) continue;
    const placeholders = table.rows[0].map(() => "?").join(", ");
    const stmt = db.prepare(`INSERT INTO ${table.tableName} VALUES (${placeholders})`);
    for (const row of table.rows) {
      stmt.run(row as (string | number | null)[]);
    }
    stmt.free();
  }
  return db;
}

/** 按语句策略清洗：仅接受单条 SELECT，容忍单个尾分号；违规返回产品提示 */
export function sanitizeStatement(sqlText: string): { ok: true; statement: string } | { ok: false; message: string } {
  let text = sqlText.trim();
  if (text.endsWith(";")) text = text.slice(0, -1).trimEnd();
  if (text.length === 0) return { ok: false, message: "演练场仅接受单条 SELECT 查询语句，请输入内容。" };
  if (text.includes(";")) return { ok: false, message: "演练场仅接受单条 SELECT 查询语句，请勿一次提交多条语句。" };
  if (!/^select\b/i.test(text)) return { ok: false, message: "演练场仅接受单条 SELECT 查询语句，INSERT/UPDATE/DELETE/DDL 均不在练习范围内。" };
  return { ok: true, statement: text };
}

/** 规范化为 MySQL 显示值：NULL 与空串严格区分、数值与字符串严格区分 */
function normalizeValue(v: unknown): DisplayValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return `N:${v}`;
  if (typeof v === "bigint") return `N:${v}`;
  return `S:${String(v)}`;
}

/** 在内存库上执行查询，返回结果集；错误抛出 SQLite errmsg 原文（由错误映射层转 MySQL 三要素）。
 * 行数上限（issue #10）：结果超限时抛防护超限错误（产品提示），不进入 MySQL 错误映射。
 * 取舍：sql.js 的 exec 同步物化全部结果行，上限检查发生在物化之后——
 * 真正的内存/时间兜底由 Worker 超时终止负责，行数上限拦截"能跑完但结果巨大"的查询。 */
export async function executeQuery(
  statement: string,
  session: Session,
  rowLimit?: number,
  time?: Date,
): Promise<ResultSet> {
  const db = await openInMemoryDb(session);
  try {
    // 转译层（issue #5）：学生 SQL 为 MySQL 方言，垫片函数 + 语法改写对学生透明
    // （sql.js 类型声明缺 create_aggregate，垫片宿主为最小结构类型）
    // 时刻为判定级常量：缺省取当前时间，由判定入口生成一次并透传两次执行
    registerShimFunctions(db as unknown as ShimHost, time);
    const result = db.exec(translateSql(statement));
    if (result.length === 0) return { columns: [], rows: [] };
    if (rowLimit !== undefined && result[0].values.length > rowLimit) {
      throw new GuardLimitError("行数上限", ROW_LIMIT_MESSAGE);
    }
    return {
      columns: result[0].columns,
      rows: result[0].values.map((row) => row.map(normalizeValue)),
    };
  } finally {
    db.close();
  }
}

/** UI 展示用的显示文本（去掉类型标记） */
export function formatValue(v: DisplayValue): string {
  return v === null ? "NULL" : v.slice(2);
}
