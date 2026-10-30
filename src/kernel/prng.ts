// 种子驱动的确定性伪随机数（mulberry32）：同种子必然复现同一序列。
export function createRandomSource(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (minInclusive: number, maxInclusive: number) =>
      minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1)),
    pick: <T>(candidates: readonly T[]): T => candidates[Math.floor(next() * candidates.length)],
    chance: (p: number) => next() < p,
  };
}

export type RandomSource = ReturnType<typeof createRandomSource>;
