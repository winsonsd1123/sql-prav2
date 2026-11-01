import { describe, expect, it } from "vitest";
import { generatePracticeSession } from "@/kernel/question-picking";
import { builtinDomainPacks } from "@/domain-packs/builtin-packs";
import { parseDomainPackJson } from "@/kernel/domain-pack-contract";
import type { DomainPack, PracticeConfiguration } from "@/kernel/types";

/**
 * 难度配额抽题（票 #61 / spec #53 目标②）：
 * generatePracticeSession 按域包 practiceConfig（演练配置，GLOSSARY「演练配置」）生成——
 * 硬约束：总题数与各难度档位数量精确命中配置；
 * 软目标：题目按知识点清单顺序推进、每个知识点尽量保底 1 题
 * （分布与保底冲突时保底让步于分布，见「让步规则」用例）。
 * 确定性：同种子 + 同配置 + 同域包内容 → 同一题目序列。
 */

/** 各难度档位的实际抽中数量 */
function tierCounts(questions: { difficulty: number }[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const q of questions) counts[q.difficulty] = (counts[q.difficulty] ?? 0) + 1;
  return counts;
}

/** 给域包替换演练配置（其余内容不动） */
function withConfig(pack: DomainPack, practiceConfig: PracticeConfiguration): DomainPack {
  return { ...pack, practiceConfig };
}

describe.each(builtinDomainPacks.map((p) => [p.name, p]))(
  "%s 按演练配置抽题（默认 10 题 1/3/3/2/1）",
  (_name, pack: DomainPack) => {
    const config = pack.practiceConfig!;

    it("总题数与各档数量精确命中配置", () => {
      for (let seed = 1; seed <= 30; seed++) {
        const questions = generatePracticeSession(seed, pack).questions;
        expect(questions).toHaveLength(config.totalQuestions);
        expect(tierCounts(questions)).toEqual({
          1: config.tierDistribution["1"],
          2: config.tierDistribution["2"],
          3: config.tierDistribution["3"],
          4: config.tierDistribution["4"],
          5: config.tierDistribution["5"],
        });
      }
    });

    it("题目按知识点清单顺序推进（序号不下降），且默认配置下每个知识点保底 1 题", () => {
      for (let seed = 1; seed <= 30; seed++) {
        const questions = generatePracticeSession(seed, pack).questions;
        const indices = questions.map((q) => pack.knowledgeAreas!.indexOf(q.knowledgeArea));
        for (let i = 1; i < indices.length; i++) {
          expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
        }
        for (const area of pack.knowledgeAreas!) {
          expect(questions.some((q) => q.knowledgeArea === area), `${area} 应至少一题`).toBe(true);
        }
      }
    });

    it("确定性：同种子同配置同域包字节级复现；换配置后序列不同（难度首次参与抽题）", () => {
      expect(JSON.stringify(generatePracticeSession(42, pack).questions)).toBe(
        JSON.stringify(generatePracticeSession(42, pack).questions),
      );
      const other = withConfig(pack, { totalQuestions: 10, tierDistribution: { "1": 2, "2": 3, "3": 3, "4": 1, "5": 1 } });
      expect(JSON.stringify(generatePracticeSession(42, other).questions)).not.toBe(
        JSON.stringify(generatePracticeSession(42, pack).questions),
      );
    });

    it("配置改为 7 题：题量与分布随之精确变化（换一套按当前配置生成）", () => {
      const seven = withConfig(pack, { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } });
      for (const seed of [1, 42, 20260101]) {
        const questions = generatePracticeSession(seed, seven).questions;
        expect(questions).toHaveLength(7);
        expect(tierCounts(questions)).toEqual({ 1: 1, 2: 2, 3: 2, 4: 1, 5: 1 });
      }
    });
  },
);

describe("让步规则（分布硬约束优先，知识点保底让步）", () => {
  // 构造：内置包A改为全低档配置（5 题 = 档1×2 + 档2×3）。
  // 子查询/综合应用等知识点的模板全部在 3 档及以上——该配置下它们没有任何可用候选，
  // 让步为 0 题；总题数与各档数量仍精确命中。
  const pack = builtinDomainPacks[0];
  const config: PracticeConfiguration = { totalQuestions: 5, tierDistribution: { "1": 2, "2": 3, "3": 0, "4": 0, "5": 0 } };
  const lowTierOnly = withConfig(pack, config);

  it("分布与保底冲突：高档-only 知识点让步为 0 题，总题数与分布仍精确命中", () => {
    for (const seed of [1, 7, 42, 99, 20260101]) {
      const questions = generatePracticeSession(seed, lowTierOnly).questions;
      expect(questions).toHaveLength(5);
      expect(tierCounts(questions)).toEqual({ 1: 2, 2: 3 });
      // 让步后仍是清单顺序推进（序号不下降）
      const indices = questions.map((q) => pack.knowledgeAreas!.indexOf(q.knowledgeArea));
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
      }
      // 高档-only 知识点确实让步（子查询模板最低 3 档）
      expect(questions.some((q) => q.knowledgeArea === "子查询")).toBe(false);
    }
  });

  it("可行时保底不丢：有可用候选的知识点仍尽量各得一题", () => {
    for (const seed of [1, 7, 42, 99, 20260101]) {
      const questions = generatePracticeSession(seed, lowTierOnly).questions;
      const covered = new Set(questions.map((q) => q.knowledgeArea));
      // 单表查询与投影（档1×2 档2×2）、条件筛选与排序（档2×5）、聚合与分组（档1×1 档2×2）
      // 均有低档候选：5 题容纳 3 个知识点的保底
      expect(covered.has("单表查询与投影")).toBe(true);
      expect(covered.has("条件筛选与排序")).toBe(true);
      expect(covered.has("聚合与分组")).toBe(true);
    }
  });

  it("同知识点内不重复模板（配置路径同样成立）", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const questions = generatePracticeSession(seed, withConfig(pack, config)).questions;
      const seen = new Set<string>();
      for (const q of questions) {
        const key = `${q.knowledgeArea}:${q.templateId}`;
        expect(seen.has(key), `同知识点内重复模板：${key}`).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("无演练配置的调用方回退旧算法", () => {
  it("剥离 practiceConfig 后不施加难度约束：固定 10 题、每知识点保底 1、顺序推进", () => {
    const pack = builtinDomainPacks[0];
    const stripped: DomainPack = {
      packId: pack.packId,
      name: pack.name,
      schemaSkeleton: pack.schemaSkeleton,
      templates: pack.templates,
      knowledgeAreas: pack.knowledgeAreas,
    };
    expect(stripped.practiceConfig).toBeUndefined();
    for (const seed of [1, 42, 20260101]) {
      const questions = generatePracticeSession(seed, stripped).questions;
      expect(questions).toHaveLength(10);
      const indices = questions.map((q) => pack.knowledgeAreas!.indexOf(q.knowledgeArea));
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
      }
      for (const area of pack.knowledgeAreas!) {
        expect(questions.some((q) => q.knowledgeArea === area)).toBe(true);
      }
    }
  });

  it("云端夹具资产转内核域包携带演练配置（A 类字段随包透传到抽题）", () => {
    // 经契约与资产转换（#57/#58）走一遍：practiceConfig 必须出现在内核域包上
    const raw = builtinDomainPacks[0];
    const assetLike = {
      packId: raw.packId,
      name: raw.name,
      schemaSkeleton: raw.schemaSkeleton,
      templates: raw.templates,
      knowledgeAreas: raw.knowledgeAreas!,
      difficultyTiers: [1, 2, 3, 4, 5].map((level) => ({
        level,
        name: `档${level}`,
        description: "测试档位",
        sampleSql: "select 1",
      })),
      practiceConfig: { totalQuestions: 6, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 0 } },
    };
    const parsed = parseDomainPackJson(assetLike);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // assetToKernelPack 的透传断言见 cloud-pack-asset 测试；此处断言抽题消费端到端可用
    const kernelPack: DomainPack = {
      packId: parsed.pack.packId,
      name: parsed.pack.name,
      schemaSkeleton: parsed.pack.schemaSkeleton,
      templates: parsed.pack.templates,
      knowledgeAreas: parsed.pack.knowledgeAreas,
      practiceConfig: parsed.pack.practiceConfig,
    };
    const questions = generatePracticeSession(42, kernelPack).questions;
    expect(questions).toHaveLength(6);
    expect(tierCounts(questions)).toEqual({ 1: 1, 2: 2, 3: 2, 4: 1 });
  });
});
