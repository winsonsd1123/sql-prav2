import { describe, expect, it } from "vitest";
import { generatePracticeSession } from "@/kernel/question-picking";
import { generateSession } from "@/kernel/generate";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";
import { loadPackB } from "@/domain-packs/employee-department-salary/pack-b";
import type { DomainPack } from "@/kernel/types";

/**
 * 会话按知识点出题（issue #8 / T7；题量固定 10 见 issue #13 / T2）：
 * 接缝：generatePracticeSession(seed, pack) → session（题目为按七知识点顺序抽取的 10 题实例）。
 * 确定性：同种子同域包 → 同题序同题集（字节级）。
 */

const knowledgeAreaOrder = [
  "单表查询与投影",
  "条件筛选与排序",
  "聚合与分组",
  "多表 JOIN",
  "子查询",
  "日期函数",
  "综合应用",
];

const packs: DomainPack[] = [loadPackA(), loadPackB()];

describe.each(packs.map((pack) => [pack.name, pack]))(
  "%s 会话按知识点出题",
  (_name, pack: DomainPack) => {
    it("题量恒为 10（与种子无关）", () => {
      for (let seed = 1; seed <= 50; seed++) {
        expect(generatePracticeSession(seed, pack).questions).toHaveLength(10);
      }
    });

    it("题目按七知识点顺序推进（知识点序号构成不下降序列），且每个知识点至少出现一次", () => {
      for (let seed = 1; seed <= 50; seed++) {
        const session = generatePracticeSession(seed, pack);
        const indices = session.questions.map((q) => knowledgeAreaOrder.indexOf(q.knowledgeArea));
        expect(indices.every((n) => n >= 0)).toBe(true);
        for (let i = 1; i < indices.length; i++) {
          expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
        }
        for (const area of knowledgeAreaOrder) {
          expect(session.questions.some((q) => q.knowledgeArea === area), `${area} 应至少一题`).toBe(true);
        }
      }
    });

    it("同一知识点内不重复抽同一模板", () => {
      for (let seed = 1; seed <= 50; seed++) {
        const session = generatePracticeSession(seed, pack);
        const seen = new Set<string>();
        for (const q of session.questions) {
          const key = `${q.knowledgeArea}:${q.templateId}`;
          expect(seen.has(key), `同知识点内重复模板：${key}`).toBe(false);
          seen.add(key);
        }
      }
    });

    it("确定性：同种子同域包字节级复现", () => {
      expect(JSON.stringify(generatePracticeSession(20260101, pack))).toBe(
        JSON.stringify(generatePracticeSession(20260101, pack)),
      );
    });

    it("异种子：题集或题序发生变化", () => {
      const promptOrder = (session: ReturnType<typeof generatePracticeSession>) =>
        JSON.stringify(session.questions.map((q) => q.templateId));
      const baseline = promptOrder(generatePracticeSession(20260101, pack));
      let hasDiff = false;
      for (let seed = 20260102; seed <= 20260130; seed++) {
        if (promptOrder(generatePracticeSession(seed, pack)) !== baseline) {
          hasDiff = true;
          break;
        }
      }
      expect(hasDiff).toBe(true);
    });

    it("库与全量生成同种子一致（抽题不改库），题目实例均为可判题形态", () => {
      const session = generatePracticeSession(20260101, pack);
      const fullSession = generateSession(20260101, pack);
      expect(JSON.stringify(session.database)).toBe(JSON.stringify(fullSession.database));
      expect(session.seed).toBe(20260101);
      expect(session.packId).toBe(pack.packId);
      for (const q of session.questions) {
        expect(q.referenceAnswer.length).toBeGreaterThan(0);
        expect(q.prompt.length).toBeGreaterThan(0);
      }
    });
  },
);

