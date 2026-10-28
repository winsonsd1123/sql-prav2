// 会话进度的纯函数状态机：通过题号、已看提示层级、已借助答案题号、按题尝试次数与 SQL 草稿（issue #9、#15、#16）。
// 状态为不可变值，迁移函数返回新状态；持久化由调用方按 进度键 写入 localStorage。

export interface 进度记录 {
  /** 已判定通过的题号（0 起） */
  已通过题号: number[];
  /** 题号 → 已揭示的提示层数（1 或 2） */
  已看提示: Record<string, number>;
  /** 已查看过参考答案的题号（0 起），通过前查看才记入（语义收紧，issue #16） */
  已借助答案题号: number[];
  /** 题号 → 验证提交次数（口径：不通过/错误/拦截均计，通过不计） */
  尝试次数: Record<string, number>;
  /** 题号 → SQL 草稿文本（issue #15）：切题保留、随会话（域包+种子）持久 */
  草稿: Record<string, string>;
}

export const 空进度: 进度记录 = {
  已通过题号: [],
  已看提示: {},
  已借助答案题号: [],
  尝试次数: {},
  草稿: {},
};

/** 进度随会话（域包 + 种子）持久：换一套或换域包即换键，等价于重置 */
export function 进度键(域包ID: string, 种子: number): string {
  return `sql-playground:progress:${域包ID}:${种子}`;
}

/** 记一次验证提交尝试（口径：不通过/错误/拦截均计；通过的提交由调用方不记，issue #16） */
export function 记尝试(进度: 进度记录, 题号: number): 进度记录 {
  const 次 = (进度.尝试次数[String(题号)] ?? 0) + 1;
  return { ...进度, 尝试次数: { ...进度.尝试次数, [String(题号)]: 次 } };
}

/** 题号 i 是否已通过 */
export function 是否已通过(进度: 进度记录, 题号: number): boolean {
  return 进度.已通过题号.includes(题号);
}

/** 提示解锁门槛（ADR-0003 摩擦力）：该题尝试 ≥1；已通过的题全解锁 */
export function 提示是否解锁(进度: 进度记录, 题号: number): boolean {
  if (是否已通过(进度, 题号)) return true;
  return (进度.尝试次数[String(题号)] ?? 0) >= 1;
}

/**
 * 答案解锁门槛：不通过尝试累计 ≥3，或已看提示且尝试 ≥2；已通过的题全解锁。
 * 豁免（T5，ADR-0003 修订 v3）：持「随时查看参考答案」权限点者免门槛直接解锁；
 * 缺省 false，学生路径零变化。
 */
export function 答案是否解锁(进度: 进度记录, 题号: number, 豁免 = false): boolean {
  if (豁免) return true;
  if (是否已通过(进度, 题号)) return true;
  const 尝试 = 进度.尝试次数[String(题号)] ?? 0;
  if (尝试 >= 3) return true;
  const 已看 = 进度.已看提示[String(题号)] ?? 0;
  return 已看 >= 1 && 尝试 >= 2;
}

/**
 * 距答案解锁还差的尝试次数（口径与 答案是否解锁 一致）：
 * 已通过或已解锁返回 0；否则按门槛（已看提示 ≥1 层为 2 次，否则 3 次）减去已有尝试。
 * 门槛知识归本模块单一来源，UI 只展示不重述。
 */
export function 答案解锁还差尝试(进度: 进度记录, 题号: number, 豁免 = false): number {
  if (答案是否解锁(进度, 题号, 豁免)) return 0;
  const 尝试 = 进度.尝试次数[String(题号)] ?? 0;
  const 已看 = 进度.已看提示[String(题号)] ?? 0;
  const 门槛 = 已看 >= 1 ? 2 : 3;
  return Math.max(0, 门槛 - 尝试);
}

/** 记录第 i 题通过（幂等） */
export function 记通过(进度: 进度记录, 题号: number): 进度记录 {
  if (进度.已通过题号.includes(题号)) return 进度;
  return { ...进度, 已通过题号: [...进度.已通过题号, 题号].sort((a, b) => a - b) };
}

/** 揭示第 题号 题的下一层提示：返回 [新进度, 揭示到的层数]（已到顶层则不变） */
export function 揭示下一层提示(进度: 进度记录, 题号: number): [进度记录, number] {
  const 已看 = 进度.已看提示[String(题号)] ?? 0;
  if (已看 >= 2) return [进度, 2];
  const 新层数 = 已看 + 1;
  return [{ ...进度, 已看提示: { ...进度.已看提示, [String(题号)]: 新层数 } }, 新层数];
}

/**
 * 从当前题号向后环形查找第一个未通过的题（issue #18 T7）：
 * 跳着做题不遗漏（绕回题首），任意做题顺序都收敛；全部通过返回 null。
 */
export function 下一未通过题(进度: 进度记录, 当前题号: number, 总题数: number): number | null {
  for (let 步 = 1; 步 <= 总题数; 步++) {
    const 题号 = (当前题号 + 步) % 总题数;
    if (!进度.已通过题号.includes(题号)) return 题号;
  }
  return null;
}

/** 完成度：x/总题数 */
export function 完成度(进度: 进度记录, 总题数: number): { 已完成: number; 总数: number } {
  return { 已完成: 进度.已通过题号.length, 总数: 总题数 };
}

/**
 * 完成分档统计（issue #19 T8，GLOSSARY「完成分档」）：只统计通过题，每道恰好一档——
 * 借助答案（通过前查看，语义由 查看答案 收紧保证）＞借助提示（看过提示层）＞独立完成。
 */
export function 完成分档统计(
  进度: 进度记录,
  总题数: number,
): { 独立完成: number; 借助提示: number; 借助答案: number } {
  let 独立完成 = 0;
  let 借助提示 = 0;
  let 借助答案 = 0;
  for (let 题号 = 0; 题号 < 总题数; 题号++) {
    if (!进度.已通过题号.includes(题号)) continue;
    if (进度.已借助答案题号.includes(题号)) 借助答案++;
    else if ((进度.已看提示[String(题号)] ?? 0) >= 1) 借助提示++;
    else 独立完成++;
  }
  return { 独立完成, 借助提示, 借助答案 };
}

/**
 * 查看参考答案（ADR-0003 语义收紧）：通过前查看记入"已借助答案"并挂徽章，
 * 通过后查看仅展示不记录。返回 [新进度, 是否记入借助]。
 * 豁免（T5，ADR-0003 修订 v3）：持「随时查看参考答案」权限点者的查看属教学检视，
 * 不写入「已借助答案」、不计完成分档——进度原样返回。
 */
export function 查看答案(进度: 进度记录, 题号: number, 豁免 = false): [进度记录, boolean] {
  if (豁免) return [进度, false];
  if (是否已通过(进度, 题号)) return [进度, false];
  if (进度.已借助答案题号.includes(题号)) return [进度, true];
  return [{ ...进度, 已借助答案题号: [...进度.已借助答案题号, 题号] }, true];
}

/** 记录第 题号 题的 SQL 草稿（issue #15）：内容未变原样返回（幂等），空串清除该题草稿 */
export function 记草稿(进度: 进度记录, 题号: number, SQL: string): 进度记录 {
  const 键 = String(题号);
  const 现有 = 进度.草稿[键];
  if (SQL === "") {
    if (现有 === undefined) return 进度;
    const 新草稿 = { ...进度.草稿 };
    delete 新草稿[键];
    return { ...进度, 草稿: 新草稿 };
  }
  if (现有 === SQL) return 进度;
  return { ...进度, 草稿: { ...进度.草稿, [键]: SQL } };
}

/** 读取第 题号 题的 SQL 草稿，无草稿回退空串 */
export function 取草稿(进度: 进度记录, 题号: number): string {
  return 进度.草稿[String(题号)] ?? "";
}

/** 题号 i 是否已借助答案 */
export function 是否借助答案(进度: 进度记录, 题号: number): boolean {
  return 进度.已借助答案题号.includes(题号);
}

/**
 * 从 localStorage 的原始字符串解析进度，非法/缺字段时回退到空进度。
 * 纯函数化以便单测。
 */
export function 解析进度(原始: string | null): 进度记录 {
  if (原始 === null) return 空进度;
  try {
    const obj = JSON.parse(原始) as Partial<进度记录>;
    if (
      !Array.isArray(obj.已通过题号) ||
      !obj.已通过题号.every((n) => Number.isInteger(n) && n >= 0)
    ) {
      return 空进度;
    }
    const 借助 = Array.isArray(obj.已借助答案题号)
      ? obj.已借助答案题号.filter((n) => Number.isInteger(n) && n >= 0)
      : [];
    const 提示: Record<string, number> = {};
    if (obj.已看提示 && typeof obj.已看提示 === "object") {
      for (const [k, v] of Object.entries(obj.已看提示)) {
        if (/^\d+$/.test(k) && (v === 1 || v === 2)) 提示[k] = v;
      }
    }
    // 尝试次数为新增字段（issue #16）：旧数据缺失时回退为空记录
    const 尝试: Record<string, number> = {};
    if (obj.尝试次数 && typeof obj.尝试次数 === "object") {
      for (const [k, v] of Object.entries(obj.尝试次数)) {
        if (/^\d+$/.test(k) && Number.isInteger(v) && v >= 0) 尝试[k] = v;
      }
    }
    // 草稿向后兼容（issue #15）：旧数据缺字段回退空草稿，只收留数字题号→字符串条目
    const 草稿: Record<string, string> = {};
    if (obj.草稿 && typeof obj.草稿 === "object") {
      for (const [k, v] of Object.entries(obj.草稿)) {
        if (/^\d+$/.test(k) && typeof v === "string") 草稿[k] = v;
      }
    }
    return {
      已通过题号: obj.已通过题号 as number[],
      已借助答案题号: 借助,
      已看提示: 提示,
      尝试次数: 尝试,
      草稿,
    };
  } catch {
    return 空进度;
  }
}
