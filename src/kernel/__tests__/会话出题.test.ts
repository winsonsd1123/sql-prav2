import { describe, expect, it } from "vitest";
import { 生成练习会话 } from "@/kernel/出题";
import { 生成 } from "@/kernel/generate";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";
import { 加载域包B } from "@/domain-packs/员工部门薪资/域包B";
import type { 域包 } from "@/kernel/types";

/**
 * 会话按知识点出题（issue #8 / T7；题量固定 10 见 issue #13 / T2）：
 * 接缝：生成练习会话(种子, 域包) → 会话（题目为按七知识点顺序抽取的 10 题实例）。
 * 确定性：同种子同域包 → 同题序同题集（字节级）。
 */

const 知识点顺序 = [
  "单表查询与投影",
  "条件筛选与排序",
  "聚合与分组",
  "多表 JOIN",
  "子查询",
  "日期函数",
  "综合应用",
];

const 域包们: 域包[] = [加载域包A(), 加载域包B()];

describe.each(域包们.map((域包) => [域包.名称, 域包]))(
  "%s 会话按知识点出题",
  (_名称, 域包: 域包) => {
    it("题量恒为 10（与种子无关）", () => {
      for (let 种子 = 1; 种子 <= 50; 种子++) {
        expect(生成练习会话(种子, 域包).题目).toHaveLength(10);
      }
    });

    it("题目按七知识点顺序推进（知识点序号构成不下降序列），且每个知识点至少出现一次", () => {
      for (let 种子 = 1; 种子 <= 50; 种子++) {
        const 会话 = 生成练习会话(种子, 域包);
        const 序号们 = 会话.题目.map((q) => 知识点顺序.indexOf(q.知识点));
        expect(序号们.every((n) => n >= 0)).toBe(true);
        for (let i = 1; i < 序号们.length; i++) {
          expect(序号们[i]).toBeGreaterThanOrEqual(序号们[i - 1]);
        }
        for (const 知识点 of 知识点顺序) {
          expect(会话.题目.some((q) => q.知识点 === 知识点), `${知识点} 应至少一题`).toBe(true);
        }
      }
    });

    it("同一知识点内不重复抽同一模板", () => {
      for (let 种子 = 1; 种子 <= 50; 种子++) {
        const 会话 = 生成练习会话(种子, 域包);
        const 已见 = new Set<string>();
        for (const q of 会话.题目) {
          const 键 = `${q.知识点}:${q.模板ID}`;
          expect(已见.has(键), `同知识点内重复模板：${键}`).toBe(false);
          已见.add(键);
        }
      }
    });

    it("确定性：同种子同域包字节级复现", () => {
      expect(JSON.stringify(生成练习会话(20260101, 域包))).toBe(
        JSON.stringify(生成练习会话(20260101, 域包)),
      );
    });

    it("异种子：题集或题序发生变化", () => {
      const 题面序 = (会话: ReturnType<typeof 生成练习会话>) =>
        JSON.stringify(会话.题目.map((q) => q.模板ID));
      const 基准 = 题面序(生成练习会话(20260101, 域包));
      let 有差异 = false;
      for (let 种子 = 20260102; 种子 <= 20260130; 种子++) {
        if (题面序(生成练习会话(种子, 域包)) !== 基准) {
          有差异 = true;
          break;
        }
      }
      expect(有差异).toBe(true);
    });

    it("库与全量生成同种子一致（抽题不改库），题目实例均为可判题形态", () => {
      const 会话 = 生成练习会话(20260101, 域包);
      const 全量 = 生成(20260101, 域包);
      expect(JSON.stringify(会话.库)).toBe(JSON.stringify(全量.库));
      expect(会话.种子).toBe(20260101);
      expect(会话.域包ID).toBe(域包.域包ID);
      for (const q of 会话.题目) {
        expect(q.参考答案.length).toBeGreaterThan(0);
        expect(q.题面.length).toBeGreaterThan(0);
      }
    });
  },
);

