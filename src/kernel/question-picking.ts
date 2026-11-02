import type { DomainPack, Session, QuestionInstance, PracticeConfiguration } from "./types";
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
 * 会话抽题（issue #8 / T7；题量固定 10 见 issue #13 / T2；难度配额抽题见票 #61）：
 * 种子 + 域包 → 会话（库与 generateSession(seed, pack) 完全一致，题目为按知识点顺序抽取的子序列）。
 *
 * 两条路径（同种子确定性）：
 *
 * 1. 域包带演练配置（practiceConfig，票 #61；数据资产域包恒有）——难度配额抽题：
 *    - 硬约束：抽出题数 = 配置总题数；各难度档位抽中数量 = 配置分布（精确命中）。
 *    - 软目标（按优先级）：题目按知识点清单顺序推进；每个知识点尽量保底 1 题。
 *    - 让步规则（分布与保底冲突时保底让步于分布）：某知识点在「仍有配额的档位」里
 *      没有任何候选模板时，该知识点让步为 0 题——分布的硬约束不可破坏
 *      （契约已保证各档配额 ≤ 该档模板总数，全局可行）。
 *    - 算法：第一轮按清单顺序每知识点保底 1 题——在仍有配额且该知识点有候选的档位中
 *      选「剩余配额最大」者（平局取低档），从该知识点该档按种子洗牌后的候选队首取题；
 *      第二轮按知识点顺序轮转补齐剩余配额（每轮每知识点至多 1 题，档位选择同前），
 *      轮转使剩余名额尽量摊到不同知识点；最后按知识点清单顺序拼接。
 *
 * 2. 域包不带演练配置（历史调用方：自造模板的单测夹具）——旧算法保持不变：
 *    固定 10 题、每知识点保底 1、剩余名额按种子随机分配，不施加难度约束。
 */
export function generatePracticeSession(seed: number, pack: DomainPack): Session {
  const session = generateSession(seed, pack);
  return pack.practiceConfig === undefined
    ? { ...session, questions: pickByKnowledgeQuota(seed, pack, session) }
    : { ...session, questions: pickByPracticeConfig(session.seed, pack, session, pack.practiceConfig) };
}

/** 旧算法（无演练配置回退）：固定 10 题、知识点保底 + 种子随机余量 */
function pickByKnowledgeQuota(seed: number, pack: DomainPack, session: Session): QuestionInstance[] {
  const random = createRandomSource(seed);
  const questionCount = 10;

  // 知识点顺序（票 #58 下放域包字段）：优先读域包自带清单，缺省回退内置七类
  // （兼容自造模板的历史调用方；数据资产域包经契约校验必带清单）
  const areas = pack.knowledgeAreas ?? [...knowledgeAreaOrder];
  const partitions = areas.map((knowledgeArea) => {
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
  return questions;
}

/**
 * 难度配额抽题（票 #61）：按演练配置生成题目序列（算法与让步规则见函数头部注释）。
 * 确定性来源：各知识点各档候选的洗牌顺序（种子掺知识点序号与档位）+ 纯贪心/轮转规则。
 */
function pickByPracticeConfig(
  seed: number,
  pack: DomainPack,
  session: Session,
  config: PracticeConfiguration,
): QuestionInstance[] {
  // 知识点顺序（票 #58）：优先读域包自带清单，缺省回退内置七类
  const areas = pack.knowledgeAreas ?? [...knowledgeAreaOrder];

  // 各知识点的候选桶：档位 → 洗牌后的候选队列（同知识点同档内不重复模板由队列游标保证）
  const pools = areas.map((knowledgeArea, areaIndex) => {
    const candidates = session.questions.filter((q) => q.knowledgeArea === knowledgeArea);
    if (candidates.length === 0 && session.questions.length > 0) {
      throw new Error(`域包 ${pack.packId} 的知识点「${knowledgeArea}」没有任何题目模板`);
    }
    const byTier = new Map<number, QuestionInstance[]>();
    for (const question of candidates) {
      const bucket = byTier.get(question.difficulty);
      if (bucket) bucket.push(question);
      else byTier.set(question.difficulty, [question]);
    }
    for (const [tier, bucket] of byTier) {
      // 洗牌种子掺入知识点序号与档位：不同桶互不复制同一随机序列
      byTier.set(tier, shuffle(bucket, createRandomSource(seed * 1_000_003 + areaIndex * 101 + tier)));
    }
    return byTier;
  });

  // 各档剩余配额（契约保证非负、总和 = 总题数、各档 ≤ 该档模板总数）
  const remaining = new Map<number, number>();
  for (let tier = 1; tier <= 5; tier++) {
    remaining.set(tier, config.tierDistribution[String(tier)] ?? 0);
  }

  // 每个知识点已抽中的题目（保持抽中顺序，最终按知识点顺序拼接）；
  // 每个档位队列的已取数（游标，独立于知识点总取题数）
  const picked: QuestionInstance[][] = areas.map(() => []);
  const consumed: Map<number, number>[] = areas.map(() => new Map());

  /** 在某知识点的某档位取一题（队列游标推进）；无可用候选返回 null */
  const take = (areaIndex: number, tier: number): QuestionInstance | null => {
    const queue = pools[areaIndex].get(tier);
    if (queue === undefined) return null;
    const used = consumed[areaIndex].get(tier) ?? 0;
    const question = queue[used];
    if (question === undefined) return null;
    consumed[areaIndex].set(tier, used + 1);
    picked[areaIndex].push(question);
    return question;
  };

  /** 在仍有配额且该知识点有可用候选的档位中，选「剩余配额最大」者（平局取低档，确定性） */
  const pickTier = (areaIndex: number): number | null => {
    let best: number | null = null;
    for (let tier = 1; tier <= 5; tier++) {
      if ((remaining.get(tier) ?? 0) <= 0) continue;
      const queue = pools[areaIndex].get(tier);
      if (queue === undefined || queue.length <= (consumed[areaIndex].get(tier) ?? 0)) continue;
      if (best === null || (remaining.get(tier) ?? 0) > (remaining.get(best) ?? 0)) best = tier;
    }
    return best;
  };

  // 第一轮：知识点保底——清单顺序每个知识点尽量取 1 题（无可用档位者让步为 0 题）
  areas.forEach((_area, i) => {
    const tier = pickTier(i);
    if (tier !== null) {
      take(i, tier);
      remaining.set(tier, (remaining.get(tier) ?? 0) - 1);
    }
  });

  // 第二轮：按知识点顺序轮转补齐剩余配额（每轮每知识点至多 1 题，名额尽量摊开）
  let totalRemaining = [...remaining.values()].reduce((a, b) => a + b, 0);
  while (totalRemaining > 0) {
    let progressed = false;
    for (let i = 0; i < areas.length && totalRemaining > 0; i++) {
      const tier = pickTier(i);
      if (tier !== null) {
        take(i, tier);
        remaining.set(tier, (remaining.get(tier) ?? 0) - 1);
        totalRemaining--;
        progressed = true;
      }
    }
    // 全轮无进展 = 契约被绕过（各档配额 ≤ 该档模板总数时不可能发生）：
    // 防御性兜底宁可少出也不死循环或破坏档位配额
    if (!progressed) break;
  }

  return picked.flat();
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
