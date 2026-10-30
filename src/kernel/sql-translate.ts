/**
 * 转译层（ADR 0001 四层之一，issue #5）：MySQL→SQLite 方言垫片，对学生透明。
 * 路径决策（混合）：
 * - 语法级改写：GROUP_CONCAT 的 `SEPARATOR <字面量>` 是 MySQL 专属语法，SQLite
 *   无法解析，必须改写为 group_concat(x, <字面量>) 位置参数形式；
 * - 自定义函数：日期函数（NOW/CURDATE/CURTIME/DATE/YEAR/MONTH/DAY/DATEDIFF/
 *   DATE_FORMAT）与 CONCAT/CONCAT_WS 的 MySQL 语义与 SQLite 内置差异细微
 *   （返回格式、NULL 传播、格式说明符），在 sql.js 上注册 JS 实现最可控，
 *   且未注册的未知函数（如拼错）自然落回 SQLite "no such function" →
 *   映射层 1305，错误保真不受影响。
 */

/** sql.js Database 上本层依赖的最小接口（避免引具体类型，便于测试替身） */
export interface ShimHost {
  create_function: (name: string, fn: (...args: unknown[]) => unknown) => void;
  create_aggregate: (
    name: string,
    aggregate: {
      init?: () => unknown;
      step: (...args: unknown[]) => unknown;
      finalize?: (state: unknown) => unknown;
    },
  ) => void;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** 解析 MySQL 文本日期（'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS'）；非法返回 null */
function parseDate(value: unknown): DateTimeParts | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const d: DateTimeParts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
  };
  // 范围校验（与 MySQL 严格模式一致：越界视为非法日期 → NULL）
  if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31) return null;
  if (d.hour > 23 || d.minute > 59 || d.second > 59) return null;
  return d;
}

/** UTC 毫秒数（仅用于日期差，避免时区/夏令时干扰） */
const toMs = (d: DateTimeParts) => Date.UTC(d.year, d.month - 1, d.day);

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** MySQL DATE_FORMAT 格式说明符 → 结果文本（未识别说明符原样保留，与 MySQL 一致舍入到字面量） */
function formatDate(d: DateTimeParts | null, format: unknown): string | null {
  if (d === null || format === null || format === undefined) return null;
  const fmt = String(format);
  const hour12 = d.hour % 12 === 0 ? 12 : d.hour % 12;
  const dayOfYear =
    Math.floor((toMs(d) - Date.UTC(d.year, 0, 1)) / 86400000) + 1;
  const weekday = new Date(toMs(d)).getUTCDay();
  let out = "";
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] !== "%" || i === fmt.length - 1) {
      out += fmt[i];
      continue;
    }
    i++;
    switch (fmt[i]) {
      case "Y": out += String(d.year).padStart(4, "0"); break;
      case "y": out += pad2(d.year % 100); break;
      case "m": out += pad2(d.month); break;
      case "c": out += String(d.month); break;
      case "d": out += pad2(d.day); break;
      case "e": out += String(d.day); break;
      case "H": out += pad2(d.hour); break;
      case "k": out += String(d.hour); break;
      case "h": out += pad2(hour12); break;
      case "i": out += pad2(d.minute); break;
      case "s":
      case "S": out += pad2(d.second); break;
      case "f": out += "000000"; break;
      case "T": out += `${pad2(d.hour)}:${pad2(d.minute)}:${pad2(d.second)}`; break;
      case "p": out += d.hour < 12 ? "AM" : "PM"; break;
      case "M": out += monthNames[d.month - 1]; break;
      case "b": out += monthNames[d.month - 1].slice(0, 3); break;
      case "W": out += weekdayNames[weekday]; break;
      case "a": out += weekdayNames[weekday].slice(0, 3); break;
      case "j": out += String(dayOfYear).padStart(3, "0"); break;
      case "%": out += "%"; break;
      default: out += "%" + fmt[i]; break;
    }
  }
  return out;
}

/** 数值/文本按 MySQL 字符串化规则（整数无小数尾巴） */
function stringify(v: unknown): string {
  if (typeof v === "number") return String(v);
  return String(v);
}

/**
 * sql.js 以 func.length 决定注册元数（(...args) 计 0，会落到 SQLite 内置），
 * 可变参数函数须按各元数逐一注册；调用时 argc 由 SQLite 实际传入。
 */
function registerVariadic(
  db: ShimHost,
  name: string,
  fn: (...args: unknown[]) => unknown,
  maxArity = 8,
): void {
  const fixedArity = (n: number): ((...args: unknown[]) => unknown) => {
    switch (n) {
      case 0: return () => fn();
      case 1: return (a) => fn(a);
      case 2: return (a, b) => fn(a, b);
      case 3: return (a, b, c) => fn(a, b, c);
      case 4: return (a, b, c, d) => fn(a, b, c, d);
      case 5: return (a, b, c, d, e) => fn(a, b, c, d, e);
      case 6: return (a, b, c, d, e, f) => fn(a, b, c, d, e, f);
      case 7: return (a, b, c, d, e, f, g) => fn(a, b, c, d, e, f, g);
      default: return (a, b, c, d, e, f, g, h) => fn(a, b, c, d, e, f, g, h);
    }
  };
  for (let n = 0; n <= maxArity; n++) db.create_function(name, fixedArity(n));
}

/**
 * 注册垫片函数（自定义函数路径）：NOW 取值由调用方传入（判定级时刻），
 * 缺省取当前时间。时刻在判定入口生成一次、透传给学生 SQL 与参考答案的
 * 两次执行——保证「判题级一致」：同一次判定内多次执行、同一查询内多次
 * NOW() 结果均相同，毫秒抖动不会让逐字照抄参考答案的学生误判不通过。
 */
export function registerShimFunctions(db: ShimHost, time: Date = new Date()): void {
  const now = time;
  const nowParts: DateTimeParts = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  };
  const formatDateTime = (d: DateTimeParts) =>
    `${d.year}-${pad2(d.month)}-${pad2(d.day)} ${pad2(d.hour)}:${pad2(d.minute)}:${pad2(d.second)}`;

  db.create_function("NOW", () => formatDateTime(nowParts));
  db.create_function("CURDATE", () => formatDateTime(nowParts).slice(0, 10));
  db.create_function("CURTIME", () => formatDateTime(nowParts).slice(11));

  db.create_function("DATE", (v) => {
    const d = parseDate(v);
    return d === null ? null : `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
  });
  db.create_function("YEAR", (v) => parseDate(v)?.year ?? null);
  db.create_function("MONTH", (v) => parseDate(v)?.month ?? null);
  db.create_function("DAY", (v) => parseDate(v)?.day ?? null);

  db.create_function("DATEDIFF", (a, b) => {
    const start = parseDate(a);
    const end = parseDate(b);
    if (start === null || end === null) return null;
    return Math.round((toMs(start) - toMs(end)) / 86400000);
  });

  db.create_function("DATE_FORMAT", (v, format) => formatDate(parseDate(v), format));

  // MySQL CONCAT：任一参数 NULL → 结果 NULL（SQLite 内置 concat 跳过 NULL，须覆盖）
  registerVariadic(db, "CONCAT", (...args: unknown[]) =>
    args.some((v) => v === null || v === undefined)
      ? null
      : args.map(stringify).join(""),
  );
  // MySQL CONCAT_WS：分隔符 NULL → NULL；参数中的 NULL 被跳过
  registerVariadic(db, "CONCAT_WS", (...args: unknown[]) => {
    if (args.length === 0) return null;
    const [separator, ...rest] = args;
    if (separator === null || separator === undefined) return null;
    const sep = stringify(separator);
    return rest
      .filter((v) => v !== null && v !== undefined)
      .map(stringify)
      .join(sep);
  });
  // GROUP_CONCAT(DISTINCT x SEPARATOR s)：SQLite 不支持 DISTINCT 聚合带双参数，
  // 以自定义聚合实现（去 NULL、去重、按码点排序后拼接——MySQL 未指定顺序，
  // 排序保证结果确定，与采样基准一致）
  interface GroupConcatState { seen: Set<string>; values: string[]; separator: string }
  db.create_aggregate("__group_concat_distinct", {
    init: (): GroupConcatState => ({ seen: new Set(), values: [], separator: "" }),
    step(prevState: unknown, value: unknown, separator: unknown): unknown {
      const state = prevState as GroupConcatState;
      if (value !== null && value !== undefined) {
        state.separator = stringify(separator);
        const text = stringify(value);
        if (!state.seen.has(text)) {
          state.seen.add(text);
          state.values.push(text);
        }
      }
      // sql.js 约定：step 返回值即下一行状态
      return state;
    },
    finalize: (prevState: unknown) => (prevState as GroupConcatState).values.sort().join((prevState as GroupConcatState).separator),
  });
}

/** 字符串字面量（含转义的引号） */
const literalRegex = "('(?:[^']|'')*'|\"(?:[^\"]|\"\")*\")";

/**
 * 方言转译（语法级改写路径）：仅改写 SQLite 无法解析的 MySQL 专属语法。
 * - `GROUP_CONCAT(DISTINCT x SEPARATOR s)` → 自定义聚合 `__group_concat_distinct(x, s)`
 *   （SQLite 不支持 DISTINCT 聚合带分隔符双参数）；
 * - 其余 `SEPARATOR <字面量>` → 位置参数 `, <字面量>`（SQLite 原生
 *   group_concat(x, sep) 语义与 MySQL 一致：跳过 NULL、默认逗号）。
 *   SEPARATOR 是 MySQL 保留字，只出现在 GROUP_CONCAT 子句中，全局改写安全。
 * 其余构造留给自定义函数路径与 SQLite 原生能力。
 */
export function translateSql(sqlText: string): string {
  return sqlText.replace(
    new RegExp(
      `\\bGROUP_CONCAT\\s*\\(\\s*DISTINCT\\s+([\\s\\S]+?)\\s+SEPARATOR\\s+${literalRegex}\\s*\\)`,
      "gi",
    ),
    "__group_concat_distinct($1, $2)",
  ).replace(
    new RegExp(`\\bSEPARATOR\\s+${literalRegex}`, "gi"),
    ", $1",
  );
}
