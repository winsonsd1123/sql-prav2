// 会话进度的纯函数状态机：通过题号、已看提示层级、已借助答案题号（issue #9）。
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
}

export const 空进度: 进度记录 = { 已通过题号: [], 已看提示: {}, 已借助答案题号: [], 尝试次数: {} };

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

/** 答案解锁门槛：不通过尝试累计 ≥3，或已看提示且尝试 ≥2；已通过的题全解锁 */
export function 答案是否解锁(进度: 进度记录, 题号: number): boolean {
  if (是否已通过(进度, 题号)) return true;
  const 尝试 = 进度.尝试次数[String(题号)] ?? 0;
  if (尝试 >= 3) return true;
  const 已看 = 进度.已看提示[String(题号)] ?? 0;
  return 已看 >= 1 && 尝试 >= 2;
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

/** 标记第 题号 题已借助答案（幂等） */
export function 借助答案(进度: 进度记录, 题号: number): 进度记录 {
  if (进度.已借助答案题号.includes(题号)) return 进度;
  return { ...进度, 已借助答案题号: [...进度.已借助答案题号, 题号] };
}

/** 完成度：x/总题数 */
export function 完成度(进度: 进度记录, 总题数: number): { 已完成: number; 总数: number } {
  return { 已完成: 进度.已通过题号.length, 总数: 总题数 };
}

/**
 * 查看参考答案（ADR-0003 语义收紧）：通过前查看记入"已借助答案"并挂徽章，
 * 通过后查看仅展示不记录。返回 [新进度, 是否记入借助]。
 */
export function 查看答案(进度: 进度记录, 题号: number): [进度记录, boolean] {
  if (是否已通过(进度, 题号)) return [进度, false];
  if (进度.已借助答案题号.includes(题号)) return [进度, true];
  return [{ ...进度, 已借助答案题号: [...进度.已借助答案题号, 题号] }, true];
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
    return { 已通过题号: obj.已通过题号 as number[], 已借助答案题号: 借助, 已看提示: 提示, 尝试次数: 尝试 };
  } catch {
    return 空进度;
  }
}
