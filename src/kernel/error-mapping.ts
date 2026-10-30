import { MySQL } from "dt-sql-parser";

/**
 * 错误映射（判题内核"校验层 + 映射层"，见 ADR 0001）：
 * 把 dt-sql-parser 语法错误与 SQLite errmsg 映射为 MySQL 三要素
 * （错误码 / SQLSTATE / 文案），保真度基准为 fixtures/mysql-error-fixtures.json。
 */

/** MySQL 错误三要素；文案与 MySQL 客户端逐字一致 */
export interface MySqlError {
  errorCode: number;
  SQLSTATE: string;
  message: string;
}

/** MySQL 客户端样式：ERROR 1064 (42000): ... */
export function formatError(e: MySqlError): string {
  return `ERROR ${e.errorCode} (${e.SQLSTATE}): ${e.message}`;
}

const parser = new MySQL();

/** 计算语句内行列位置（dt-sql-parser 行列从 1 起）对应的字符偏移 */
function offsetOf(statement: string, line: number, column: number): number {
  if (line <= 1) return column - 1;
  const lineStart = statement.split("\n").slice(0, line - 1).join("\n").length + 1;
  return lineStart + column - 1;
}

/** MySQL 的 near 语义：从出错 token 起到语句末尾的剩余原文 */
function nearText(statement: string, start: number): string {
  return statement.slice(start).trim();
}

/**
 * 前置语法校验（校验层）：MySQL 方言解析，语法错误产出 1064 三要素。
 * 合法返回 null；near token 与行号来自解析器行列位置。
 */
export function validateSyntax(statement: string): MySqlError | null {
  const errors = parser.validate(statement);
  if (errors.length === 0) return null;
  const first = errors[0];
  let start = offsetOf(statement, first.startLine, first.startColumn);
  // 未闭合字符串：MySQL 报错位置含起始引号（夹具 near 'xxx 以引号开头）
  if (start > 0 && statement[start - 1] === "'") start -= 1;
  const near = nearText(statement, start);
  return {
    errorCode: 1064,
    SQLSTATE: "42000",
    message: `You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '${near}' at line ${first.startLine}`,
  };
}

/** 映射层统一库名前缀（与采样夹具的库一致） */
const dbName = "playground";

const Identifier = "[A-Za-z0-9_$\\u4e00-\\u9fff]+";
/** 标识符字符集（用于左侧边界：列名/前缀前一个字符不得仍是标识符字符） */
const identifierChars = "A-Za-z0-9_$\\u4e00-\\u9fff";
/** 标识符边界：\b 对中文不成立，用「非标识符字符或结尾」断言 */
const wordBoundary = "(?![A-Za-z0-9_$\\u4e00-\\u9fff])";

/** 找回列在 SQL 中的完整写法（含可选表前缀），SQLite errmsg 会丢前缀。
 * 前缀左侧同样要求非标识符边界，避免另一列名的后缀被当作前缀的一部分。 */
function recoverQualifiedUsage(statement: string, columnName: string): string {
  const qualifiedRegex = new RegExp(`(?:^|[^${identifierChars}])((?:${Identifier})\\.${columnName})${wordBoundary}`);
  const m = statement.match(qualifiedRegex);
  return m ? m[1] : columnName;
}

/** 列名是否出现在 WHERE 子句作用域内（SQLite errmsg 不含子句上下文，按原文近似判定）。
 * 列名左侧要求非标识符边界：一列名为另一列名后缀时（如 name / username），
 * 后缀列的出现不算该列出现。 */
function isInWhereClause(statement: string, columnName: string): boolean {
  const pattern = new RegExp(
    `\\bWHERE\\b[\\s\\S]*?[^${identifierChars}]${columnName}${wordBoundary}`,
    "i",
  );
  return pattern.test(statement);
}

/**
 * 运行时错误映射（映射层）：SQLite errmsg 的稳定模式 →
 * MySQL 1146（表不存在）/ 1054（列不存在）/ 1305（函数不存在）三要素；
 * 未识别模式尽力映射为 1105 (HY000)。
 */
export function mapRuntimeError(errmsg: string, statement: string): MySqlError {
  let m = errmsg.match(new RegExp(`^no such table: (\\S+)$`));
  if (m) {
    return { errorCode: 1146, SQLSTATE: "42S02", message: `Table '${dbName}.${m[1]}' doesn't exist` };
  }
  m = errmsg.match(new RegExp(`^no such column: (${Identifier}(?:\\.${Identifier})*)$`));
  if (m) {
    const usage = recoverQualifiedUsage(statement, m[1]);
    const clause = isInWhereClause(statement, m[1]) ? "where clause" : "field list";
    return { errorCode: 1054, SQLSTATE: "42S22", message: `Unknown column '${usage}' in '${clause}'` };
  }
  m = errmsg.match(new RegExp(`^no such function: (\\S+)$`));
  if (m) {
    return { errorCode: 1305, SQLSTATE: "42000", message: `FUNCTION ${dbName}.${m[1]} does not exist` };
  }
  return { errorCode: 1105, SQLSTATE: "HY000", message: errmsg };
}

/**
 * 1055 静态检查（ONLY_FULL_GROUP_BY）：GROUP BY 查询的 SELECT 列表 / ORDER BY 中
 * 出现"非聚合、不在 GROUP BY 中"的裸列时，产出与 MySQL 8 默认行为一致的 1055 三要素。
 *
 * 保守边界（解析不了或不确定时一律放行，绝不拦下 MySQL 会放行的查询）：
 * - FROM 子查询、UNION、含子查询分组依据 → 放行
 * - 未知列 / 未知表 / 歧义列 → 放行（MySQL 名字解析先于 1055，运行时映射 1054/1146）
 * - 聚合函数子树与标量子查询内部不检查；分组列上的等价表达式（学号+1）放行
 * - 生成库无主键，故不做函数依赖（GROUP BY 主键选他列）推断
 */
export interface TableSummary {
  tableName: string;
  columnNames: string[];
}

const aggregateFunctions = new Set(
  ["COUNT", "SUM", "AVG", "MIN", "MAX", "GROUP_CONCAT", "STD", "STDDEV", "STDDEV_POP", "STDDEV_SAMP", "VAR_POP", "VAR_SAMP", "VARIANCE", "BIT_AND", "BIT_OR", "BIT_XOR", "JSON_ARRAYAGG", "JSON_OBJECTAGG", "ANY", "SOME"],
);
const keywords = new Set([
  "AND", "OR", "NOT", "NULL", "IS", "LIKE", "IN", "BETWEEN", "CASE", "WHEN", "THEN", "ELSE", "END",
  "ASC", "DESC", "DISTINCT", "ALL", "SEPARATOR", "INTERVAL", "TRUE", "FALSE", "UNKNOWN", "DIV", "MOD",
  "AS", "ON", "USING", "COLLATE", "BINARY", "EXISTS", "CAST", "IF", "IFNULL", "NULLIF", "CONVERT",
]);

type Token = { kind: "标识符" | "数字" | "字符串" | "符号"; value: string };

/** 词法扫描；字符串字面量与注释整体成词（内容不参与标识符分析） */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && text[i + 1] === "-") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c; let j = i + 1;
      while (j < text.length) {
        if (text[j] === quote) { if (text[j + 1] === quote) { j += 2; continue; } break; }
        j++;
      }
      tokens.push({ kind: "字符串", value: text.slice(i, j + 1) }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) {
      const m = text.slice(i).match(/^\d+(\.\d+)?/)!;
      tokens.push({ kind: "数字", value: m[0] }); i += m[0].length; continue;
    }
    if (/[A-Za-z_$一-鿿]/.test(c)) {
      const m = text.slice(i).match(/^[A-Za-z0-9_$一-鿿]+/)!;
      tokens.push({ kind: "标识符", value: m[0] }); i += m[0].length; continue;
    }
    tokens.push({ kind: "符号", value: c }); i++;
  }
  return tokens;
}

/** 顶层按逗号切分子句项（忽略括号内逗号） */
function splitTopLevel(items: Token[]): Token[][] {
  const results: Token[][] = [[]];
  let depth = 0;
  for (const w of items) {
    if (w.value === "(") depth++;
    if (w.value === ")") depth--;
    if (w.value === "," && depth === 0) { results.push([]); continue; }
    results[results.length - 1].push(w);
  }
  return results;
}

/** 裸列引用：前缀为原书写（别名或表名），解析后指向会话库中的实际表列 */
type ColumnRef = { prefix: string | null; columnName: string; position: number };
type RefEvent = { ref: ColumnRef; resolved: { table: string; column: string } | null };

/** 收集表达式中的裸列引用：跳过聚合函数子树与标量子查询，函数名本身不算引用 */
function collectRefs(items: Token[]): RefEvent[] {
  const events: RefEvent[] = [];
  let i = 0;
  const skipParens = () => { let d = 1; i++; while (i < items.length && d > 0) { if (items[i].value === "(") d++; if (items[i].value === ")") d--; i++; } };
  while (i < items.length) {
    const w = items[i];
    if (w.kind !== "标识符") {
      if (w.value === "(" && items[i + 1]?.kind === "标识符" && items[i + 1].value.toUpperCase() === "SELECT") { skipParens(); continue; }
      i++; continue;
    }
    const upper = w.value.toUpperCase();
    const next = items[i + 1];
    if (aggregateFunctions.has(upper) && next?.value === "(") { i++; skipParens(); continue; }
    if (upper === "SELECT" && items[i - 1]?.value === "(") { i++; continue; }
    if (next?.value === "." && items[i + 2]?.kind === "标识符" && items[i + 3]?.value !== "(") {
      events.push({ ref: { prefix: w.value, columnName: items[i + 2].value, position: i }, resolved: null });
      i += 3; continue;
    }
    if (next?.value === "(" || keywords.has(upper)) { i++; continue; }
    events.push({ ref: { prefix: null, columnName: w.value, position: i }, resolved: null });
    i++;
  }
  return events;
}

/** ONLY_FULL_GROUP_BY 静态检查；放行返回 null（保守边界见函数头注释） */
export function validateGroupBy(statement: string, tables: TableSummary[]): MySqlError | null {
  const tokens = tokenize(statement);
  if (tokens.length === 0 || tokens[0].value.toUpperCase() !== "SELECT") return null;

  // 顶层子句定位（括号深度 0）
  const clauseBoundaries = new Map<string, number>();
  let depth = 0;
  let selectCount = 0;
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (w.value === "(") { depth++; continue; }
    if (w.value === ")") { depth--; continue; }
    if (depth !== 0 || w.kind !== "标识符") continue;
    const upper = w.value.toUpperCase();
    if (upper === "SELECT") { selectCount++; if (!clauseBoundaries.has("SELECT")) clauseBoundaries.set("SELECT", i); continue; }
    if (upper === "UNION") return null;
    const followedByBy = tokens[i + 1]?.value.toUpperCase() === "BY";
    if (upper === "FROM" || upper === "WHERE" || upper === "HAVING" || upper === "LIMIT") { if (!clauseBoundaries.has(upper)) clauseBoundaries.set(upper, i); continue; }
    if (upper === "GROUP" && followedByBy) { if (!clauseBoundaries.has("GROUP")) clauseBoundaries.set("GROUP", i); continue; }
    if (upper === "ORDER" && followedByBy) { if (!clauseBoundaries.has("ORDER")) clauseBoundaries.set("ORDER", i); continue; }
  }
  if (selectCount !== 1 || !clauseBoundaries.has("FROM") || !clauseBoundaries.has("GROUP")) return null;

  const boundaryOrder = [...clauseBoundaries.entries()].sort((a, b) => a[1] - b[1]);
  const clauseOf = (name: string): Token[] => {
    const start = clauseBoundaries.get(name)!;
    const index = boundaryOrder.findIndex(([n]) => n === name);
    const end = index + 1 < boundaryOrder.length ? boundaryOrder[index + 1][1] : tokens.length;
    const range = tokens.slice(start + 1, end);
    if (range.length > 0 && range[0].value.toUpperCase() === "BY") range.shift(); // GROUP/ORDER BY 的 BY 词
    return range;
  };

  // FROM 表与别名 → 实际表名；FROM 含括号（派生表等）保守放行
  const fromClause = clauseOf("FROM");
  if (fromClause.some((w) => w.value === "(")) return null;
  const aliasToTable = new Map<string, string>();
  const segments: Token[][] = [];
  let current: Token[] = [];
  let broken = false;
  for (const w of fromClause) {
    const upper = w.value.toUpperCase();
    if (upper === "ON" || upper === "USING") { broken = true; }
    if (!broken && ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "STRAIGHT_JOIN", "NATURAL"].includes(upper)) {
      segments.push(current); current = []; broken = false; continue;
    }
    if (w.value === "," && !broken) { segments.push(current); current = []; continue; }
    current.push(w);
  }
  segments.push(current);
  for (const segment of segments) {
    const identifierTokens = segment.filter((w) => w.kind === "标识符");
    if (identifierTokens.length === 0 || identifierTokens.length > 3) return null;
    const [tableToken, second, third] = identifierTokens;
    // 段形如 [表] / [表, 别名] / [表, AS, 别名]；其余结构保守放行
    if (second && !third && second.value.toUpperCase() === "AS") return null;
    const aliasToken = third ?? (second && second.value.toUpperCase() !== "AS" ? second : undefined);
    const table = tables.find((t) => t.tableName.toUpperCase() === tableToken.value.toUpperCase());
    if (!table) return null;
    aliasToTable.set(tableToken.value.toUpperCase(), table.tableName);
    if (aliasToken) aliasToTable.set(aliasToken.value.toUpperCase(), table.tableName);
  }

  const resolveColumn = (prefix: string | null, columnName: string): { table: string; column: string } | null => {
    const locate = (t: TableSummary) => t.columnNames.find((c) => c.toUpperCase() === columnName.toUpperCase());
    if (prefix) {
      const tableName = aliasToTable.get(prefix.toUpperCase());
      if (!tableName) return null;
      const t = tables.find((x) => x.tableName === tableName)!;
      const column = locate(t);
      return column ? { table: tableName, column } : null;
    }
    const candidates = [...new Set(aliasToTable.values())]
      .map((name) => tables.find((t) => t.tableName === name)!)
      .map((t) => ({ t, column: locate(t) }))
      .filter((x) => x.column);
    if (candidates.length !== 1) return null;
    return { table: candidates[0].t.tableName, column: candidates[0].column! };
  };

  // SELECT 列表项：去 DISTINCT 前缀、识别星号与别名
  const selectClause = clauseOf("SELECT");
  while (selectClause.length && ["DISTINCT", "ALL"].includes(selectClause[0].value.toUpperCase())) selectClause.shift();
  const selectItems = splitTopLevel(selectClause).filter((item) => item.length > 0);
  if (selectItems.length === 0) return null;
  const aliases = new Map<string, number>();
  const itemRefs: RefEvent[][] = [];
  const allowedAll = new Set<number>();
  selectItems.forEach((item, idx) => {
    if (item.length >= 2 && item[item.length - 2].value.toUpperCase() === "AS" && item[item.length - 1].kind === "标识符") {
      aliases.set(item[item.length - 1].value.toUpperCase(), idx);
      item.splice(item.length - 2, 2);
    } else if (item.length >= 2 && item[item.length - 1].kind === "标识符"
      && (["标识符", "数字", "字符串"].includes(item[item.length - 2].kind) || item[item.length - 2].value === ")")) {
      aliases.set(item[item.length - 1].value.toUpperCase(), idx);
      item.pop();
    }
  });
  selectItems.forEach((item) => {
    if (item.length === 1 && item[0].value === "*") { itemRefs.push([]); return; }
    itemRefs.push(collectRefs(item).map((e) => ({ ...e, resolved: resolveColumn(e.ref.prefix, e.ref.columnName) })));
  });

  // 分组依据集合：可解析列对 + 序号（GROUP BY 1）+ 别名指向的列表项
  const groupByColumns = new Set<string>();
  for (const item of splitTopLevel(clauseOf("GROUP"))) {
    if (item.length === 0) return null;
    if (item.length === 1 && item[0].kind === "数字") {
      const n = Number(item[0].value);
      if (n >= 1 && n <= selectItems.length) allowedAll.add(n - 1);
      continue;
    }
    if (item.some((w) => w.value === "(")) return null; // 含子查询的分组依据保守放行
    for (const e of collectRefs(item)) {
      const resolved = resolveColumn(e.ref.prefix, e.ref.columnName);
      if (resolved) { groupByColumns.add(`${resolved.table}.${resolved.column}`); continue; }
      const aliasTarget = !e.ref.prefix ? aliases.get(e.ref.columnName.toUpperCase()) : undefined;
      if (aliasTarget !== undefined) { allowedAll.add(aliasTarget); continue; }
      return null; // 分组依据含未知列：放行，交给运行时 1054
    }
  }

  const errorMessage = (index: number, clause: string, displayPrefix: string | null, table: string, column: string): MySqlError => ({
    errorCode: 1055,
    SQLSTATE: "42000",
    message: `Expression #${index} of ${clause} is not in GROUP BY clause and contains nonaggregated column 'playground.${displayPrefix ?? table}.${column}' which is not functionally dependent on columns in GROUP BY clause; this is incompatible with sql_mode=only_full_group_by`,
  });

  // SELECT 列表逐项检查：MySQL 按项序处理，名字解析（未知列）先于 1055
  for (let idx = 0; idx < selectItems.length; idx++) {
    if (allowedAll.has(idx)) continue;
    const item = selectItems[idx];
    if (item.length === 1 && item[0].value === "*") {
      for (const tableName of [...new Set(aliasToTable.values())]) {
        const t = tables.find((x) => x.tableName === tableName)!;
        for (const column of t.columnNames) {
          if (!groupByColumns.has(`${tableName}.${column}`)) return errorMessage(idx + 1, "SELECT list", null, tableName, column);
        }
      }
      continue;
    }
    if (item.length === 3 && item[1].value === "." && item[2].value === "*") {
      const tableName = aliasToTable.get(item[0].value.toUpperCase());
      if (!tableName) return null;
      const t = tables.find((x) => x.tableName === tableName)!;
      for (const column of t.columnNames) {
        if (!groupByColumns.has(`${tableName}.${column}`)) return errorMessage(idx + 1, "SELECT list", item[0].value, tableName, column);
      }
      continue;
    }
    const events = itemRefs[idx];
    const firstViolation = [...events].sort((a, b) => a.ref.position - b.ref.position).find((e) => !e.resolved || !groupByColumns.has(`${e.resolved.table}.${e.resolved.column}`));
    if (!firstViolation) continue;
    if (!firstViolation.resolved) return null; // 未知列在先：放行，交给运行时 1054/1146
    return errorMessage(idx + 1, "SELECT list", firstViolation.ref.prefix, firstViolation.resolved.table, firstViolation.resolved.column);
  }

  // ORDER BY：序号 / 别名 / 聚合允许，裸列须在分组依据中
  if (clauseBoundaries.has("ORDER")) {
    const orderItems = splitTopLevel(clauseOf("ORDER")).filter((item) => item.length > 0);
    for (let idx = 0; idx < orderItems.length; idx++) {
      const item = orderItems[idx];
      if (item[item.length - 1]?.kind === "标识符" && ["ASC", "DESC"].includes(item[item.length - 1].value.toUpperCase())) item.pop();
      if (item.length === 1 && item[0].kind === "数字") continue;
      const events = collectRefs(item).map((e) => ({ ...e, resolved: resolveColumn(e.ref.prefix, e.ref.columnName) }));
      const firstViolation = [...events].sort((a, b) => a.ref.position - b.ref.position).find((e) => {
        if (!e.resolved) return true;
        if (!e.ref.prefix && aliases.has(e.ref.columnName.toUpperCase())) return false;
        return !groupByColumns.has(`${e.resolved.table}.${e.resolved.column}`);
      });
      if (!firstViolation) continue;
      if (!firstViolation.resolved) return null;
      return errorMessage(idx + 1, "ORDER BY clause", firstViolation.ref.prefix, firstViolation.resolved.table, firstViolation.resolved.column);
    }
  }
  return null;
}
