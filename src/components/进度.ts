// 会话进度的纯函数状态机：通过题号、已看提示层级、已借助答案题号、按题 SQL 草稿（issue #9、#15）。
// 状态为不可变值，迁移函数返回新状态；持久化由调用方按 进度键 写入 localStorage。

export interface 进度记录 {
  /** 已判定通过的题号（0 起） */
  已通过题号: number[];
  /** 题号 → 已揭示的提示层数（1 或 2） */
  已看提示: Record<string, number>;
  /** 已查看过参考答案的题号（0 起），查看后该题永久标注"已借助答案" */
  已借助答案题号: number[];
  /** 题号 → SQL 草稿文本（issue #15）：切题保留、随会话（域包+种子）持久 */
  草稿: Record<string, string>;
}

export const 空进度: 进度记录 = { 已通过题号: [], 已看提示: {}, 已借助答案题号: [], 草稿: {} };

/** 进度随会话（域包 + 种子）持久：换一套或换域包即换键，等价于重置 */
export function 进度键(域包ID: string, 种子: number): string {
  return `sql-playground:progress:${域包ID}:${种子}`;
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
    // 草稿向后兼容（issue #15）：旧数据缺字段回退空草稿，只收留数字题号→字符串条目
    const 草稿: Record<string, string> = {};
    if (obj.草稿 && typeof obj.草稿 === "object") {
      for (const [k, v] of Object.entries(obj.草稿)) {
        if (/^\d+$/.test(k) && typeof v === "string") 草稿[k] = v;
      }
    }
    return { 已通过题号: obj.已通过题号 as number[], 已借助答案题号: 借助, 已看提示: 提示, 草稿 };
  } catch {
    return 空进度;
  }
}
