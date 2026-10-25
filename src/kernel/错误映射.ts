import { MySQL } from "dt-sql-parser";

/**
 * 错误映射（判题内核"校验层 + 映射层"，见 ADR 0001）：
 * 把 dt-sql-parser 语法错误与 SQLite errmsg 映射为 MySQL 三要素
 * （错误码 / SQLSTATE / 文案），保真度基准为 fixtures/MySQL错误夹具.json。
 */

/** MySQL 错误三要素；文案与 MySQL 客户端逐字一致 */
export interface MySQL错误 {
  错误码: number;
  SQLSTATE: string;
  文案: string;
}

/** MySQL 客户端样式：ERROR 1064 (42000): ... */
export function 格式化(e: MySQL错误): string {
  return `ERROR ${e.错误码} (${e.SQLSTATE}): ${e.文案}`;
}

const 解析器 = new MySQL();

/** 计算语句内行列位置（dt-sql-parser 行列从 1 起）对应的字符偏移 */
function 偏移(语句: string, 行: number, 列: number): number {
  if (行 <= 1) return 列 - 1;
  const 行首 = 语句.split("\n").slice(0, 行 - 1).join("\n").length + 1;
  return 行首 + 列 - 1;
}

/** MySQL 的 near 语义：从出错 token 起到语句末尾的剩余原文 */
function near文本(语句: string, 起: number): string {
  return 语句.slice(起).trim();
}

/**
 * 前置语法校验（校验层）：MySQL 方言解析，语法错误产出 1064 三要素。
 * 合法返回 null；near token 与行号来自解析器行列位置。
 */
export function 校验语法(语句: string): MySQL错误 | null {
  const 错误 = 解析器.validate(语句);
  if (错误.length === 0) return null;
  const 首 = 错误[0];
  let 起 = 偏移(语句, 首.startLine, 首.startColumn);
  // 未闭合字符串：MySQL 报错位置含起始引号（夹具 near 'xxx 以引号开头）
  if (起 > 0 && 语句[起 - 1] === "'") 起 -= 1;
  const near = near文本(语句, 起);
  return {
    错误码: 1064,
    SQLSTATE: "42000",
    文案: `You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '${near}' at line ${首.startLine}`,
  };
}

/** 映射层统一库名前缀（与采样夹具的库一致） */
const 库名 = "playground";

const 标识符 = "[A-Za-z0-9_$\\u4e00-\\u9fff]+";
/** 标识符边界：\b 对中文不成立，用「非标识符字符或结尾」断言 */
const 边界 = "(?![A-Za-z0-9_$\\u4e00-\\u9fff])";

/** 找回列在 SQL 中的完整写法（含可选表前缀），SQLite errmsg 会丢前缀 */
function 找回写法(语句: string, 列名: string): string {
  const 带前缀 = new RegExp(`(${标识符})\\.${列名}${边界}`);
  const m = 语句.match(带前缀);
  return m ? `${m[1]}.${列名}` : 列名;
}

/** 列名是否出现在 WHERE 子句作用域内（SQLite errmsg 不含子句上下文，按原文近似判定） */
function 在WHERE中(语句: string, 列名: string): boolean {
  const 模式 = new RegExp(`\\bWHERE\\b[\\s\\S]*?${列名}${边界}`, "i");
  return 模式.test(语句);
}

/**
 * 运行时错误映射（映射层）：SQLite errmsg 的稳定模式 →
 * MySQL 1146（表不存在）/ 1054（列不存在）/ 1305（函数不存在）三要素；
 * 未识别模式尽力映射为 1105 (HY000)。
 */
export function 映射运行时错误(errmsg: string, 语句: string): MySQL错误 {
  let m = errmsg.match(new RegExp(`^no such table: (\\S+)$`));
  if (m) {
    return { 错误码: 1146, SQLSTATE: "42S02", 文案: `Table '${库名}.${m[1]}' doesn't exist` };
  }
  m = errmsg.match(new RegExp(`^no such column: (${标识符}(?:\\.${标识符})*)$`));
  if (m) {
    const 写法 = 找回写法(语句, m[1]);
    const 子句 = 在WHERE中(语句, m[1]) ? "where clause" : "field list";
    return { 错误码: 1054, SQLSTATE: "42S22", 文案: `Unknown column '${写法}' in '${子句}'` };
  }
  m = errmsg.match(new RegExp(`^no such function: (\\S+)$`));
  if (m) {
    return { 错误码: 1305, SQLSTATE: "42000", 文案: `FUNCTION ${库名}.${m[1]} does not exist` };
  }
  return { 错误码: 1105, SQLSTATE: "HY000", 文案: errmsg };
}
