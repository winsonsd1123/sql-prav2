// 种子驱动的确定性伪随机数（mulberry32）：同种子必然复现同一序列。
export function 创建随机源(种子: number) {
  let s = 种子 >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    整数: (含下限: number, 含上限: number) =>
      含下限 + Math.floor(next() * (含上限 - 含下限 + 1)),
    抽取: <T>(候选: readonly T[]): T => 候选[Math.floor(next() * 候选.length)],
    概率: (p: number) => next() < p,
  };
}

export type 随机源 = ReturnType<typeof 创建随机源>;
