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
export interface 垫片宿主 {
  create_function: (名: string, 函数: (...参数: unknown[]) => unknown) => void;
  create_aggregate: (
    名: string,
    聚合: {
      init?: () => unknown;
      step: (...参数: unknown[]) => unknown;
      finalize?: (状态: unknown) => unknown;
    },
  ) => void;
}

const 两位 = (n: number) => String(n).padStart(2, "0");

interface 日期时刻 {
  年: number;
  月: number;
  日: number;
  时: number;
  分: number;
  秒: number;
}

/** 解析 MySQL 文本日期（'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS'）；非法返回 null */
function 解析日期(值: unknown): 日期时刻 | null {
  if (值 === null || 值 === undefined) return null;
  const 文本 = String(值).trim();
  const m = 文本.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const d: 日期时刻 = {
    年: Number(m[1]),
    月: Number(m[2]),
    日: Number(m[3]),
    时: Number(m[4] ?? 0),
    分: Number(m[5] ?? 0),
    秒: Number(m[6] ?? 0),
  };
  // 范围校验（与 MySQL 严格模式一致：越界视为非法日期 → NULL）
  if (d.月 < 1 || d.月 > 12 || d.日 < 1 || d.日 > 31) return null;
  if (d.时 > 23 || d.分 > 59 || d.秒 > 59) return null;
  return d;
}

/** UTC 毫秒数（仅用于日期差，避免时区/夏令时干扰） */
const 毫秒 = (d: 日期时刻) => Date.UTC(d.年, d.月 - 1, d.日);

const 月份英文 = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const 星期英文 = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** MySQL DATE_FORMAT 格式说明符 → 结果文本（未识别说明符原样保留，与 MySQL 一致舍入到字面量） */
function 格式化日期(d: 日期时刻 | null, 格式: unknown): string | null {
  if (d === null || 格式 === null || 格式 === undefined) return null;
  const fmt = String(格式);
  const 时制12 = d.时 % 12 === 0 ? 12 : d.时 % 12;
  const 年内日 =
    Math.floor((毫秒(d) - Date.UTC(d.年, 0, 1)) / 86400000) + 1;
  const 星期 = new Date(毫秒(d)).getUTCDay();
  let 出 = "";
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] !== "%" || i === fmt.length - 1) {
      出 += fmt[i];
      continue;
    }
    i++;
    switch (fmt[i]) {
      case "Y": 出 += String(d.年).padStart(4, "0"); break;
      case "y": 出 += 两位(d.年 % 100); break;
      case "m": 出 += 两位(d.月); break;
      case "c": 出 += String(d.月); break;
      case "d": 出 += 两位(d.日); break;
      case "e": 出 += String(d.日); break;
      case "H": 出 += 两位(d.时); break;
      case "k": 出 += String(d.时); break;
      case "h": 出 += 两位(时制12); break;
      case "i": 出 += 两位(d.分); break;
      case "s":
      case "S": 出 += 两位(d.秒); break;
      case "f": 出 += "000000"; break;
      case "T": 出 += `${两位(d.时)}:${两位(d.分)}:${两位(d.秒)}`; break;
      case "p": 出 += d.时 < 12 ? "AM" : "PM"; break;
      case "M": 出 += 月份英文[d.月 - 1]; break;
      case "b": 出 += 月份英文[d.月 - 1].slice(0, 3); break;
      case "W": 出 += 星期英文[星期]; break;
      case "a": 出 += 星期英文[星期].slice(0, 3); break;
      case "j": 出 += String(年内日).padStart(3, "0"); break;
      case "%": 出 += "%"; break;
      default: 出 += "%" + fmt[i]; break;
    }
  }
  return 出;
}

/** 数值/文本按 MySQL 字符串化规则（整数无小数尾巴） */
function 字符串化(v: unknown): string {
  if (typeof v === "number") return String(v);
  return String(v);
}

/**
 * sql.js 以 func.length 决定注册元数（(...参数) 计 0，会落到 SQLite 内置），
 * 可变参数函数须按各元数逐一注册；调用时 argc 由 SQLite 实际传入。
 */
function 注册变参函数(
  db: 垫片宿主,
  名: string,
  函数: (...参数: unknown[]) => unknown,
  最大参数数 = 8,
): void {
  const 定长 = (n: number): ((...参数: unknown[]) => unknown) => {
    switch (n) {
      case 0: return () => 函数();
      case 1: return (a) => 函数(a);
      case 2: return (a, b) => 函数(a, b);
      case 3: return (a, b, c) => 函数(a, b, c);
      case 4: return (a, b, c, d) => 函数(a, b, c, d);
      case 5: return (a, b, c, d, e) => 函数(a, b, c, d, e);
      case 6: return (a, b, c, d, e, f) => 函数(a, b, c, d, e, f);
      case 7: return (a, b, c, d, e, f, g) => 函数(a, b, c, d, e, f, g);
      default: return (a, b, c, d, e, f, g, h) => 函数(a, b, c, d, e, f, g, h);
    }
  };
  for (let n = 0; n <= 最大参数数; n++) db.create_function(名, 定长(n));
}

/**
 * 注册垫片函数（自定义函数路径）：NOW 取值在本次注册时固定，
 * 对应 MySQL「语句级一致」语义——同一查询内多次 NOW() 结果相同。
 */
export function 注册垫片函数(db: 垫片宿主): void {
  const 现在 = new Date();
  const 当下: 日期时刻 = {
    年: 现在.getFullYear(),
    月: 现在.getMonth() + 1,
    日: 现在.getDate(),
    时: 现在.getHours(),
    分: 现在.getMinutes(),
    秒: 现在.getSeconds(),
  };
  const 文本时刻 = (d: 日期时刻) =>
    `${d.年}-${两位(d.月)}-${两位(d.日)} ${两位(d.时)}:${两位(d.分)}:${两位(d.秒)}`;

  db.create_function("NOW", () => 文本时刻(当下));
  db.create_function("CURDATE", () => 文本时刻(当下).slice(0, 10));
  db.create_function("CURTIME", () => 文本时刻(当下).slice(11));

  db.create_function("DATE", (v) => {
    const d = 解析日期(v);
    return d === null ? null : `${d.年}-${两位(d.月)}-${两位(d.日)}`;
  });
  db.create_function("YEAR", (v) => 解析日期(v)?.年 ?? null);
  db.create_function("MONTH", (v) => 解析日期(v)?.月 ?? null);
  db.create_function("DAY", (v) => 解析日期(v)?.日 ?? null);

  db.create_function("DATEDIFF", (a, b) => {
    const 起 = 解析日期(a);
    const 止 = 解析日期(b);
    if (起 === null || 止 === null) return null;
    return Math.round((毫秒(起) - 毫秒(止)) / 86400000);
  });

  db.create_function("DATE_FORMAT", (v, 格式) => 格式化日期(解析日期(v), 格式));

  // MySQL CONCAT：任一参数 NULL → 结果 NULL（SQLite 内置 concat 跳过 NULL，须覆盖）
  注册变参函数(db, "CONCAT", (...参数: unknown[]) =>
    参数.some((v) => v === null || v === undefined)
      ? null
      : 参数.map(字符串化).join(""),
  );
  // MySQL CONCAT_WS：分隔符 NULL → NULL；参数中的 NULL 被跳过
  注册变参函数(db, "CONCAT_WS", (...参数: unknown[]) => {
    if (参数.length === 0) return null;
    const [分隔符, ...其余] = 参数;
    if (分隔符 === null || 分隔符 === undefined) return null;
    const sep = 字符串化(分隔符);
    return 其余
      .filter((v) => v !== null && v !== undefined)
      .map(字符串化)
      .join(sep);
  });
  // GROUP_CONCAT(DISTINCT x SEPARATOR s)：SQLite 不支持 DISTINCT 聚合带双参数，
  // 以自定义聚合实现（去 NULL、去重、按码点排序后拼接——MySQL 未指定顺序，
  // 排序保证结果确定，与采样基准一致）
  interface 去重拼接状态 { 见过: Set<string>; 值: string[]; 分隔符: string }
  db.create_aggregate("__group_concat_distinct", {
    init: (): 去重拼接状态 => ({ 见过: new Set(), 值: [], 分隔符: "" }),
    step(原状态: unknown, 值: unknown, 分隔符: unknown): unknown {
      const 状态 = 原状态 as 去重拼接状态;
      if (值 !== null && 值 !== undefined) {
        状态.分隔符 = 字符串化(分隔符);
        const 文本 = 字符串化(值);
        if (!状态.见过.has(文本)) {
          状态.见过.add(文本);
          状态.值.push(文本);
        }
      }
      // sql.js 约定：step 返回值即下一行状态
      return 状态;
    },
    finalize: (原状态: unknown) => (原状态 as 去重拼接状态).值.sort().join((原状态 as 去重拼接状态).分隔符),
  });
}

/** 字符串字面量（含转义的引号） */
const 字面量 = "('(?:[^']|'')*'|\"(?:[^\"]|\"\")*\")";

/**
 * 方言转译（语法级改写路径）：仅改写 SQLite 无法解析的 MySQL 专属语法。
 * - `GROUP_CONCAT(DISTINCT x SEPARATOR s)` → 自定义聚合 `__group_concat_distinct(x, s)`
 *   （SQLite 不支持 DISTINCT 聚合带分隔符双参数）；
 * - 其余 `SEPARATOR <字面量>` → 位置参数 `, <字面量>`（SQLite 原生
 *   group_concat(x, sep) 语义与 MySQL 一致：跳过 NULL、默认逗号）。
 *   SEPARATOR 是 MySQL 保留字，只出现在 GROUP_CONCAT 子句中，全局改写安全。
 * 其余构造留给自定义函数路径与 SQLite 原生能力。
 */
export function 转译(SQL文本: string): string {
  return SQL文本.replace(
    new RegExp(
      `\\bGROUP_CONCAT\\s*\\(\\s*DISTINCT\\s+([\\s\\S]+?)\\s+SEPARATOR\\s+${字面量}\\s*\\)`,
      "gi",
    ),
    "__group_concat_distinct($1, $2)",
  ).replace(
    new RegExp(`\\bSEPARATOR\\s+${字面量}`, "gi"),
    ", $1",
  );
}
