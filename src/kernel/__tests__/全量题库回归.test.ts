import { describe, expect, it } from "vitest";
import { 生成 } from "@/kernel/generate";
import { 判定 } from "@/kernel/judge";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";
import { 加载域包B } from "@/domain-packs/员工部门薪资/域包B";
import type { 域包 } from "@/kernel/types";

/**
 * 全量判题等价回归（issue #7 / T6 建立，issue #8 / T7 泛化为跨域包驱动）：
 * 每个域包的每个题目模板，跨多个种子（随机实例）验证三件事——
 * 1. 参考答案自判通过；
 * 2. 列序颠倒的正确变体通过（列序不敏感是结果等价的承诺）；
 * 3. 模板声明的典型错误写法判不通过（防止判题过松）。
 * 典型错误写法随模板以 YAML 静态资源声明，与参考答案同占位符实例化。
 */
const 域包们: 域包[] = [加载域包A(), 加载域包B()];
const 种子列表 = [42, 43, 44];

const 七个知识点 = [
  "单表查询与投影",
  "条件筛选与排序",
  "聚合与分组",
  "多表 JOIN",
  "子查询",
  "日期函数",
  "综合应用",
];

/** 列序颠倒的正确变体：把参考答案 SELECT 后的列清单反转（括号内的逗号不属于列分隔） */
function 列序颠倒(sql: string): string {
  const m = sql.match(/^select\s+(.+?)\s+from\s+(.+)$/i);
  if (!m) return sql;
  let 深度 = 0;
  const 项: string[] = [];
  let 当前 = "";
  for (const ch of m[1]) {
    if (ch === "(") 深度++;
    if (ch === ")") 深度--;
    if (ch === "," && 深度 === 0) {
      项.push(当前.trim());
      当前 = "";
    } else 当前 += ch;
  }
  项.push(当前.trim());
  if (项.length < 2) return sql;
  return `SELECT ${项.reverse().join(", ")} FROM ${m[2]}`;
}

describe.each(域包们.map((域包) => [域包.名称, 域包]))(
  "%s 全量题库结构",
  (_名称, 域包: 域包) => {
    it("模板总数在 25-35 之间", () => {
      expect(域包.题目模板.length).toBeGreaterThanOrEqual(25);
      expect(域包.题目模板.length).toBeLessThanOrEqual(35);
    });

    it("七个知识点分区各有至少 3 题", () => {
      const 计数 = new Map<string, number>();
      for (const t of 域包.题目模板) 计数.set(t.知识点, (计数.get(t.知识点) ?? 0) + 1);
      for (const 知识点 of 七个知识点) {
        expect(计数.get(知识点) ?? 0, `${知识点} 应至少 3 题`).toBeGreaterThanOrEqual(3);
      }
    });

    it("每个模板含难度 1-5、两层提示与典型错误写法", () => {
      for (const t of 域包.题目模板) {
        expect(t.难度).toBeGreaterThanOrEqual(1);
        expect(t.难度).toBeLessThanOrEqual(5);
        expect(t.提示).toHaveLength(2);
        expect(t.错误写法, `${t.模板ID} 应声明典型错误写法`).toBeTruthy();
      }
    });

    it("含 ORDER BY 的题必须 ordered，不含的必须非 ordered", () => {
      for (const t of 域包.题目模板) {
        const 含排序 = /order\s+by/i.test(t.参考答案);
        expect(t.ordered, `${t.模板ID} 的 ordered 应与是否含 ORDER BY 一致`).toBe(含排序);
      }
    });

    it("聚合/JOIN 分区至少 3 个模板声明语义陷阱变体（code-review #1）", () => {
      const 聚合与JOIN = 域包.题目模板.filter(
        (t) => t.知识点 === "聚合与分组" || t.知识点 === "多表 JOIN",
      );
      const 含陷阱 = 聚合与JOIN.filter((t) => (t.语义陷阱 ?? []).length > 0);
      expect(含陷阱.length, "应至少 3 个模板声明语义陷阱").toBeGreaterThanOrEqual(3);
    });
  },
);

for (const 域包 of 域包们) {
  describe.each(种子列表)(`${域包.名称}全量判题等价回归（seed=%i）`, (种子) => {
    const 会话 = 生成(种子, 域包);

    it.each(会话.题目.map((题目) => [题目.模板ID, 题目]))(
      "模板 %s 参考答案自判通过",
      async (_id, 题目) => {
        expect(await 判定(题目.参考答案, 会话, 题目)).toEqual({ 判定: "通过" });
      },
    );

    it.each(会话.题目.map((题目) => [题目.模板ID, 题目]))(
      "模板 %s 列序颠倒变体通过",
      async (_id, 题目) => {
        const 变体 = 列序颠倒(题目.参考答案);
        if (变体 === 题目.参考答案) return; // 单列查询无变体
        expect(await 判定(变体, 会话, 题目)).toEqual({ 判定: "通过" });
      },
    );

    it.each(会话.题目.map((题目) => [题目.模板ID, 题目]))(
      "模板 %s 典型错误写法判不通过",
      async (_id, 题目) => {
        const 错误 = 题目.错误写法!;
        const 结果 = await 判定(错误, 会话, 题目);
        // 典型错误均为合法 SELECT，应在结果比对层被判不通过，而非语法/运行时错误
        expect(结果.判定, `错误写法应判不通过：${错误}`).toBe("不通过");
      },
    );

    // 语义陷阱变体（code-review #1）：聚合函数用错 / JOIN 条件错位 / 分组依据错位等
    it.each(
      会话.题目.flatMap((题目) =>
        (题目.语义陷阱 ?? []).map((陷阱, i) => [`${题目.模板ID}#${i}`, 陷阱, 题目] as const),
      ),
    )(
      "模板 %s 语义陷阱变体判不通过",
      async (_键, 陷阱, 题目) => {
        const 结果 = await 判定(陷阱, 会话, 题目);
        expect(结果.判定, `语义陷阱应判不通过：${陷阱}`).toBe("不通过");
      },
    );
  });
}
