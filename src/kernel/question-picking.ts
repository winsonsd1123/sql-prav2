import type { DomainPack, Session, QuestionInstance } from "./types";
import { generateSession } from "./generate";
import { createRandomSource } from "./prng";

/** 会话内题目推进的知识点顺序（GLOSSARY「知识点」：会话按此顺序推进抽题） */
export const knowledgeAreaOrder = [
  "单表查询与投影",
  "条件筛选与排序",
  "聚合与分组",
  "多表 JOIN",
  "子查询",
  "日期函数",
  "综合应用",
] as const;

/**
 * 会话按知识点出题（issue #8 / T7，判题内核纯函数）：
 * 种子 + 域包 → 会话（库与 generateSession(seed, pack) 完全一致，题目为按七知识点顺序抽取的 10 题）。
 *
 * 抽题规则（同种子确定性）：
 * 1. 题量为固定常量 10（issue #13 / T2，不再由种子驱动）；
 * 2. 每个知识点保底 1 题，剩余名额按种子随机分配给还有余量的知识点
 *    （单知识点至多出满其模板数）；
 * 3. 每个知识点的候选模板按种子洗牌后按配额取前若干题，再按知识点顺序拼接，
 *    保证题目按知识点顺序推进、每个知识点至少一题、同知识点内不重复模板。
 */
export function generatePracticeSession(seed: number, pack: DomainPack): Session {
  const random = createRandomSource(seed);
  const questionCount = 10;
  const session = generateSession(seed, pack);

  const partitions = knowledgeAreaOrder.map((knowledgeArea) => {
    const candidates = session.questions.filter((q) => q.knowledgeArea === knowledgeArea);
    if (candidates.length === 0 && session.questions.length > 0) {
      throw new Error(`域包 ${pack.packId} 的知识点「${knowledgeArea}」没有任何题目模板`);
    }
    return shuffle(candidates, createRandomSource(seed));
  });

  // 配额：每知识点保底 1，剩余名额按种子分配给尚有余量（配额 < 分区大小）的知识点
  const quota = partitions.map(() => 1);
  for (let remaining = questionCount - quota.length; remaining > 0; remaining--) {
    const quotaLeft = quota.map((n, i) => (n < partitions[i].length ? i : -1)).filter((i) => i >= 0);
    if (quotaLeft.length === 0) break;
    quota[random.pick(quotaLeft)]++;
  }

  const questions: QuestionInstance[] = [];
  partitions.forEach((candidates, i) => {
    questions.push(...candidates.slice(0, quota[i]));
  });
  return { ...session, questions };
}

/** Fisher-Yates 洗牌（种子驱动，确定性） */
function shuffle<T>(items: readonly T[], random: ReturnType<typeof createRandomSource>): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random.int(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
