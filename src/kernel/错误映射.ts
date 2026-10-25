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
/** 标识符字符集（用于左侧边界：列名/前缀前一个字符不得仍是标识符字符） */
const 标识符字符 = "A-Za-z0-9_$\\u4e00-\\u9fff";
/** 标识符边界：\b 对中文不成立，用「非标识符字符或结尾」断言 */
const 边界 = "(?![A-Za-z0-9_$\\u4e00-\\u9fff])";

/** 找回列在 SQL 中的完整写法（含可选表前缀），SQLite errmsg 会丢前缀。
 * 前缀左侧同样要求非标识符边界，避免另一列名的后缀被当作前缀的一部分。 */
function 找回写法(语句: string, 列名: string): string {
  const 带前缀 = new RegExp(`(?:^|[^${标识符字符}])((?:${标识符})\\.${列名})${边界}`);
  const m = 语句.match(带前缀);
  return m ? m[1] : 列名;
}

/** 列名是否出现在 WHERE 子句作用域内（SQLite errmsg 不含子句上下文，按原文近似判定）。
 * 列名左侧要求非标识符边界：一列名为另一列名后缀时（如 name / username），
 * 后缀列的出现不算该列出现。 */
function 在WHERE中(语句: string, 列名: string): boolean {
  const 模式 = new RegExp(
    `\\bWHERE\\b[\\s\\S]*?[^${标识符字符}]${列名}${边界}`,
    "i",
  );
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
export interface 表概要 {
  表名: string;
  列名: string[];
}

const 聚合函数集 = new Set(
  ["COUNT", "SUM", "AVG", "MIN", "MAX", "GROUP_CONCAT", "STD", "STDDEV", "STDDEV_POP", "STDDEV_SAMP", "VAR_POP", "VAR_SAMP", "VARIANCE", "BIT_AND", "BIT_OR", "BIT_XOR", "JSON_ARRAYAGG", "JSON_OBJECTAGG", "ANY", "SOME"],
);
const 保留词集 = new Set([
  "AND", "OR", "NOT", "NULL", "IS", "LIKE", "IN", "BETWEEN", "CASE", "WHEN", "THEN", "ELSE", "END",
  "ASC", "DESC", "DISTINCT", "ALL", "SEPARATOR", "INTERVAL", "TRUE", "FALSE", "UNKNOWN", "DIV", "MOD",
  "AS", "ON", "USING", "COLLATE", "BINARY", "EXISTS", "CAST", "IF", "IFNULL", "NULLIF", "CONVERT",
]);

type 词 = { 类型: "标识符" | "数字" | "字符串" | "符号"; 值: string };

/** 词法扫描；字符串字面量与注释整体成词（内容不参与标识符分析） */
function 扫描(文本: string): 词[] {
  const 词列表: 词[] = [];
  let i = 0;
  while (i < 文本.length) {
    const c = 文本[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && 文本[i + 1] === "-") { while (i < 文本.length && 文本[i] !== "\n") i++; continue; }
    if (c === "/" && 文本[i + 1] === "*") { i += 2; while (i < 文本.length && !(文本[i] === "*" && 文本[i + 1] === "/")) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const 引 = c; let j = i + 1;
      while (j < 文本.length) {
        if (文本[j] === 引) { if (文本[j + 1] === 引) { j += 2; continue; } break; }
        j++;
      }
      词列表.push({ 类型: "字符串", 值: 文本.slice(i, j + 1) }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) {
      const m = 文本.slice(i).match(/^\d+(\.\d+)?/)!;
      词列表.push({ 类型: "数字", 值: m[0] }); i += m[0].length; continue;
    }
    if (/[A-Za-z_$一-鿿]/.test(c)) {
      const m = 文本.slice(i).match(/^[A-Za-z0-9_$一-鿿]+/)!;
      词列表.push({ 类型: "标识符", 值: m[0] }); i += m[0].length; continue;
    }
    词列表.push({ 类型: "符号", 值: c }); i++;
  }
  return 词列表;
}

/** 顶层按逗号切分子句项（忽略括号内逗号） */
function 切分(items: 词[]): 词[][] {
  const 结果: 词[][] = [[]];
  let 深度 = 0;
  for (const w of items) {
    if (w.值 === "(") 深度++;
    if (w.值 === ")") 深度--;
    if (w.值 === "," && 深度 === 0) { 结果.push([]); continue; }
    结果[结果.length - 1].push(w);
  }
  return 结果;
}

/** 裸列引用：前缀为原书写（别名或表名），解析后指向会话库中的实际表列 */
type 引用 = { 前缀: string | null; 列名: string; 位置: number };
type 引用事件 = { 引用: 引用; 解析: { 表: string; 列: string } | null };

/** 收集表达式中的裸列引用：跳过聚合函数子树与标量子查询，函数名本身不算引用 */
function 收集引用(items: 词[]): 引用事件[] {
  const 事件: 引用事件[] = [];
  let i = 0;
  const 跳过括号 = () => { let d = 1; i++; while (i < items.length && d > 0) { if (items[i].值 === "(") d++; if (items[i].值 === ")") d--; i++; } };
  while (i < items.length) {
    const w = items[i];
    if (w.类型 !== "标识符") {
      if (w.值 === "(" && items[i + 1]?.类型 === "标识符" && items[i + 1].值.toUpperCase() === "SELECT") { 跳过括号(); continue; }
      i++; continue;
    }
    const 大写 = w.值.toUpperCase();
    const 后 = items[i + 1];
    if (聚合函数集.has(大写) && 后?.值 === "(") { i++; 跳过括号(); continue; }
    if (大写 === "SELECT" && items[i - 1]?.值 === "(") { i++; continue; }
    if (后?.值 === "." && items[i + 2]?.类型 === "标识符" && items[i + 3]?.值 !== "(") {
      事件.push({ 引用: { 前缀: w.值, 列名: items[i + 2].值, 位置: i }, 解析: null });
      i += 3; continue;
    }
    if (后?.值 === "(" || 保留词集.has(大写)) { i++; continue; }
    事件.push({ 引用: { 前缀: null, 列名: w.值, 位置: i }, 解析: null });
    i++;
  }
  return 事件;
}

/** ONLY_FULL_GROUP_BY 静态检查；放行返回 null（保守边界见函数头注释） */
export function 校验分组(语句: string, 表列表: 表概要[]): MySQL错误 | null {
  const 词列表 = 扫描(语句);
  if (词列表.length === 0 || 词列表[0].值.toUpperCase() !== "SELECT") return null;

  // 顶层子句定位（括号深度 0）
  const 子句边界 = new Map<string, number>();
  let 深度 = 0;
  let select数 = 0;
  for (let i = 0; i < 词列表.length; i++) {
    const w = 词列表[i];
    if (w.值 === "(") { 深度++; continue; }
    if (w.值 === ")") { 深度--; continue; }
    if (深度 !== 0 || w.类型 !== "标识符") continue;
    const 大写 = w.值.toUpperCase();
    if (大写 === "SELECT") { select数++; if (!子句边界.has("SELECT")) 子句边界.set("SELECT", i); continue; }
    if (大写 === "UNION") return null;
    const 后随BY = 词列表[i + 1]?.值.toUpperCase() === "BY";
    if (大写 === "FROM" || 大写 === "WHERE" || 大写 === "HAVING" || 大写 === "LIMIT") { if (!子句边界.has(大写)) 子句边界.set(大写, i); continue; }
    if (大写 === "GROUP" && 后随BY) { if (!子句边界.has("GROUP")) 子句边界.set("GROUP", i); continue; }
    if (大写 === "ORDER" && 后随BY) { if (!子句边界.has("ORDER")) 子句边界.set("ORDER", i); continue; }
  }
  if (select数 !== 1 || !子句边界.has("FROM") || !子句边界.has("GROUP")) return null;

  const 边界序 = [...子句边界.entries()].sort((a, b) => a[1] - b[1]);
  const 取子句 = (名: string): 词[] => {
    const 起 = 子句边界.get(名)!;
    const 索引 = 边界序.findIndex(([n]) => n === 名);
    const 止 = 索引 + 1 < 边界序.length ? 边界序[索引 + 1][1] : 词列表.length;
    const 区 = 词列表.slice(起 + 1, 止);
    if (区.length > 0 && 区[0].值.toUpperCase() === "BY") 区.shift(); // GROUP/ORDER BY 的 BY 词
    return 区;
  };

  // FROM 表与别名 → 实际表名；FROM 含括号（派生表等）保守放行
  const FROM区 = 取子句("FROM");
  if (FROM区.some((w) => w.值 === "(")) return null;
  const 前缀映射 = new Map<string, string>();
  const 段列表: 词[][] = [];
  let 当前: 词[] = [];
  let 中断 = false;
  for (const w of FROM区) {
    const 大写 = w.值.toUpperCase();
    if (大写 === "ON" || 大写 === "USING") { 中断 = true; }
    if (!中断 && ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "STRAIGHT_JOIN", "NATURAL"].includes(大写)) {
      段列表.push(当前); 当前 = []; 中断 = false; continue;
    }
    if (w.值 === "," && !中断) { 段列表.push(当前); 当前 = []; continue; }
    当前.push(w);
  }
  段列表.push(当前);
  for (const 段 of 段列表) {
    const 名词 = 段.filter((w) => w.类型 === "标识符");
    if (名词.length === 0 || 名词.length > 3) return null;
    const [表词, 第二, 第三] = 名词;
    // 段形如 [表] / [表, 别名] / [表, AS, 别名]；其余结构保守放行
    if (第二 && !第三 && 第二.值.toUpperCase() === "AS") return null;
    const 别名词 = 第三 ?? (第二 && 第二.值.toUpperCase() !== "AS" ? 第二 : undefined);
    const 表 = 表列表.find((t) => t.表名.toUpperCase() === 表词.值.toUpperCase());
    if (!表) return null;
    前缀映射.set(表词.值.toUpperCase(), 表.表名);
    if (别名词) 前缀映射.set(别名词.值.toUpperCase(), 表.表名);
  }

  const 解析列 = (前缀: string | null, 列名: string): { 表: string; 列: string } | null => {
    const 定位 = (t: 表概要) => t.列名.find((c) => c.toUpperCase() === 列名.toUpperCase());
    if (前缀) {
      const 表名 = 前缀映射.get(前缀.toUpperCase());
      if (!表名) return null;
      const t = 表列表.find((x) => x.表名 === 表名)!;
      const 列 = 定位(t);
      return 列 ? { 表: 表名, 列 } : null;
    }
    const 候选 = [...new Set(前缀映射.values())]
      .map((名) => 表列表.find((t) => t.表名 === 名)!)
      .map((t) => ({ t, 列: 定位(t) }))
      .filter((x) => x.列);
    if (候选.length !== 1) return null;
    return { 表: 候选[0].t.表名, 列: 候选[0].列! };
  };

  // SELECT 列表项：去 DISTINCT 前缀、识别星号与别名
  const SELECT区 = 取子句("SELECT");
  while (SELECT区.length && ["DISTINCT", "ALL"].includes(SELECT区[0].值.toUpperCase())) SELECT区.shift();
  const 列表项 = 切分(SELECT区).filter((项) => 项.length > 0);
  if (列表项.length === 0) return null;
  const 别名 = new Map<string, number>();
  const 项引用: 引用事件[][] = [];
  const 全允许 = new Set<number>();
  列表项.forEach((项, idx) => {
    if (项.length >= 2 && 项[项.length - 2].值.toUpperCase() === "AS" && 项[项.length - 1].类型 === "标识符") {
      别名.set(项[项.length - 1].值.toUpperCase(), idx);
      项.splice(项.length - 2, 2);
    } else if (项.length >= 2 && 项[项.length - 1].类型 === "标识符"
      && (["标识符", "数字", "字符串"].includes(项[项.length - 2].类型) || 项[项.length - 2].值 === ")")) {
      别名.set(项[项.length - 1].值.toUpperCase(), idx);
      项.pop();
    }
  });
  列表项.forEach((项) => {
    if (项.length === 1 && 项[0].值 === "*") { 项引用.push([]); return; }
    项引用.push(收集引用(项).map((e) => ({ ...e, 解析: 解析列(e.引用.前缀, e.引用.列名) })));
  });

  // 分组依据集合：可解析列对 + 序号（GROUP BY 1）+ 别名指向的列表项
  const 分组列 = new Set<string>();
  for (const 项 of 切分(取子句("GROUP"))) {
    if (项.length === 0) return null;
    if (项.length === 1 && 项[0].类型 === "数字") {
      const n = Number(项[0].值);
      if (n >= 1 && n <= 列表项.length) 全允许.add(n - 1);
      continue;
    }
    if (项.some((w) => w.值 === "(")) return null; // 含子查询的分组依据保守放行
    for (const e of 收集引用(项)) {
      const 解析 = 解析列(e.引用.前缀, e.引用.列名);
      if (解析) { 分组列.add(`${解析.表}.${解析.列}`); continue; }
      const 指向 = !e.引用.前缀 ? 别名.get(e.引用.列名.toUpperCase()) : undefined;
      if (指向 !== undefined) { 全允许.add(指向); continue; }
      return null; // 分组依据含未知列：放行，交给运行时 1054
    }
  }

  const 文案 = (号: number, 子句: string, 显示前缀: string | null, 表: string, 列: string): MySQL错误 => ({
    错误码: 1055,
    SQLSTATE: "42000",
    文案: `Expression #${号} of ${子句} is not in GROUP BY clause and contains nonaggregated column 'playground.${显示前缀 ?? 表}.${列}' which is not functionally dependent on columns in GROUP BY clause; this is incompatible with sql_mode=only_full_group_by`,
  });

  // SELECT 列表逐项检查：MySQL 按项序处理，名字解析（未知列）先于 1055
  for (let idx = 0; idx < 列表项.length; idx++) {
    if (全允许.has(idx)) continue;
    const 项 = 列表项[idx];
    if (项.length === 1 && 项[0].值 === "*") {
      for (const 表名 of [...new Set(前缀映射.values())]) {
        const t = 表列表.find((x) => x.表名 === 表名)!;
        for (const 列 of t.列名) {
          if (!分组列.has(`${表名}.${列}`)) return 文案(idx + 1, "SELECT list", null, 表名, 列);
        }
      }
      continue;
    }
    if (项.length === 3 && 项[1].值 === "." && 项[2].值 === "*") {
      const 表名 = 前缀映射.get(项[0].值.toUpperCase());
      if (!表名) return null;
      const t = 表列表.find((x) => x.表名 === 表名)!;
      for (const 列 of t.列名) {
        if (!分组列.has(`${表名}.${列}`)) return 文案(idx + 1, "SELECT list", 项[0].值, 表名, 列);
      }
      continue;
    }
    const 事件 = 项引用[idx];
    const 首个 = [...事件].sort((a, b) => a.引用.位置 - b.引用.位置).find((e) => !e.解析 || !分组列.has(`${e.解析.表}.${e.解析.列}`));
    if (!首个) continue;
    if (!首个.解析) return null; // 未知列在先：放行，交给运行时 1054/1146
    return 文案(idx + 1, "SELECT list", 首个.引用.前缀, 首个.解析.表, 首个.解析.列);
  }

  // ORDER BY：序号 / 别名 / 聚合允许，裸列须在分组依据中
  if (子句边界.has("ORDER")) {
    const 项列表 = 切分(取子句("ORDER")).filter((项) => 项.length > 0);
    for (let idx = 0; idx < 项列表.length; idx++) {
      const 项 = 项列表[idx];
      if (项[项.length - 1]?.类型 === "标识符" && ["ASC", "DESC"].includes(项[项.length - 1].值.toUpperCase())) 项.pop();
      if (项.length === 1 && 项[0].类型 === "数字") continue;
      const 事件 = 收集引用(项).map((e) => ({ ...e, 解析: 解析列(e.引用.前缀, e.引用.列名) }));
      const 首个 = [...事件].sort((a, b) => a.引用.位置 - b.引用.位置).find((e) => {
        if (!e.解析) return true;
        if (!e.引用.前缀 && 别名.has(e.引用.列名.toUpperCase())) return false;
        return !分组列.has(`${e.解析.表}.${e.解析.列}`);
      });
      if (!首个) continue;
      if (!首个.解析) return null;
      return 文案(idx + 1, "ORDER BY clause", 首个.引用.前缀, 首个.解析.表, 首个.解析.列);
    }
  }
  return null;
}
