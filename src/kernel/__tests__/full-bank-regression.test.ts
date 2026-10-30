import { describe, expect, it } from "vitest";
import { generateSession } from "@/kernel/generate";
import { judge } from "@/kernel/judge";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";
import { loadPackB } from "@/domain-packs/employee-department-salary/pack-b";
import type { DomainPack } from "@/kernel/types";

/**
 * 全量判题等价回归（issue #7 / T6 建立，issue #8 / T7 泛化为跨域包驱动）：
 * 每个域包的每个题目模板，跨多个种子（随机实例）验证三件事——
 * 1. 参考答案自判通过；
 * 2. 列序颠倒的正确变体通过（列序不敏感是结果等价的承诺）；
 * 3. 模板声明的典型错误写法判不通过（防止判题过松）。
 * 典型错误写法随模板以 YAML 静态资源声明，与参考答案同占位符实例化。
 */
const packs: DomainPack[] = [loadPackA(), loadPackB()];
const seeds = [42, 43, 44];

const SEVEN_AREAS = [
  "单表查询与投影",
  "条件筛选与排序",
  "聚合与分组",
  "多表 JOIN",
  "子查询",
  "日期函数",
  "综合应用",
];

/** 列序颠倒的正确变体：把参考答案 SELECT 后的列清单反转（括号内的逗号不属于列分隔） */
function reverseColumnOrder(sql: string): string {
  const m = sql.match(/^select\s+(.+?)\s+from\s+(.+)$/i);
  if (!m) return sql;
  let depth = 0;
  const item: string[] = [];
  let current = "";
  for (const ch of m[1]) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      item.push(current.trim());
      current = "";
    } else current += ch;
  }
  item.push(current.trim());
  if (item.length < 2) return sql;
  return `SELECT ${item.reverse().join(", ")} FROM ${m[2]}`;
}

describe.each(packs.map((pack) => [pack.name, pack]))(
  "%s 全量题库结构",
  (_name, pack: DomainPack) => {
    it("模板总数在 25-35 之间", () => {
      expect(pack.templates.length).toBeGreaterThanOrEqual(25);
      expect(pack.templates.length).toBeLessThanOrEqual(35);
    });

    it("七个知识点分区各有至少 3 题", () => {
      const count = new Map<string, number>();
      for (const t of pack.templates) count.set(t.knowledgeArea, (count.get(t.knowledgeArea) ?? 0) + 1);
      for (const area of SEVEN_AREAS) {
        expect(count.get(area) ?? 0, `${area} 应至少 3 题`).toBeGreaterThanOrEqual(3);
      }
    });

    it("每个模板含难度 1-5、两层提示与典型错误写法", () => {
      for (const t of pack.templates) {
        expect(t.difficulty).toBeGreaterThanOrEqual(1);
        expect(t.difficulty).toBeLessThanOrEqual(5);
        expect(t.hints).toHaveLength(2);
        expect(t.commonMistake, `${t.templateId} 应声明典型错误写法`).toBeTruthy();
      }
    });

    it("含 ORDER BY 的题必须 ordered，不含的必须非 ordered", () => {
      for (const t of pack.templates) {
        const hasOrderBy = /order\s+by/i.test(t.referenceAnswer);
        expect(t.ordered, `${t.templateId} 的 ordered 应与是否含 ORDER BY 一致`).toBe(hasOrderBy);
      }
    });

    it("聚合/JOIN 分区至少 3 个模板声明语义陷阱变体（code-review #1）", () => {
      const aggregationJoins = pack.templates.filter(
        (t) => t.knowledgeArea === "聚合与分组" || t.knowledgeArea === "多表 JOIN",
      );
      const hasTraps = aggregationJoins.filter((t) => (t.semanticTrap ?? []).length > 0);
      expect(hasTraps.length, "应至少 3 个模板声明语义陷阱").toBeGreaterThanOrEqual(3);
    });
  },
);

for (const pack of packs) {
  describe.each(seeds)(`${pack.name}全量判题等价回归（seed=%i）`, (seed) => {
    const session = generateSession(seed, pack);

    it.each(session.questions.map((question) => [question.templateId, question]))(
      "模板 %s 参考答案自判通过",
      async (_id, question) => {
        expect(await judge(question.referenceAnswer, session, question)).toEqual({ judge: "通过" });
      },
    );

    it.each(session.questions.map((question) => [question.templateId, question]))(
      "模板 %s 列序颠倒变体通过",
      async (_id, question) => {
        const variant = reverseColumnOrder(question.referenceAnswer);
        if (variant === question.referenceAnswer) return; // 单列查询无变体
        expect(await judge(variant, session, question)).toEqual({ judge: "通过" });
      },
    );

    it.each(session.questions.map((question) => [question.templateId, question]))(
      "模板 %s 典型错误写法判不通过",
      async (_id, question) => {
        const wrongSql = question.commonMistake!;
        const result = await judge(wrongSql, session, question);
        // 典型错误均为合法 SELECT，应在结果比对层被判不通过，而非语法/运行时错误
        expect(result.judge, `错误写法应判不通过：${wrongSql}`).toBe("不通过");
      },
    );

    // 语义陷阱变体（code-review #1）：聚合函数用错 / JOIN 条件错位 / 分组依据错位等
    it.each(
      session.questions.flatMap((question) =>
        (question.semanticTrap ?? []).map((trap, i) => [`${question.templateId}#${i}`, trap, question] as const),
      ),
    )(
      "模板 %s 语义陷阱变体判不通过",
      async (_key, trap, question) => {
        const result = await judge(trap, session, question);
        expect(result.judge, `语义陷阱应判不通过：${trap}`).toBe("不通过");
      },
    );
  });
}
