import { describe, expect, it } from "vitest";
import { 构造对照 } from "@/components/对照";
import type { 结果集 } from "@/kernel/types";

const 集 = (列名: string[], 行: (string | null)[][]): 结果集 => ({ 列名, 行 });

describe("差异对照构造", () => {
  it("完全一致：无差异标记", () => {
    const 视图 = 构造对照(集(["a", "b"], [["1", "x"]]), 集(["a", "b"], [["1", "x"]]), false);
    expect(视图.左.行差异).toEqual([false]);
    expect(视图.右.行差异).toEqual([false]);
    expect(视图.左.行[0].every((格) => !格.差异)).toBe(true);
    expect(视图.截断说明).toBeNull();
  });

  it("列序不同但列名相同：学生侧按预期列名重排，不算差异", () => {
    const 视图 = 构造对照(
      集(["b", "a"], [["x", "1"]]),
      集(["a", "b"], [["1", "x"]]),
      false,
    );
    expect(视图.左.列名).toEqual(["a", "b"]);
    expect(视图.左.列差异).toEqual([false, false]);
    expect(视图.左.行差异).toEqual([false]);
  });

  it("ordered：按位置比对并定位差异单元格", () => {
    const 视图 = 构造对照(
      集(["a", "b"], [["1", "x"], ["2", "y"]]),
      集(["a", "b"], [["1", "z"], ["2", "y"]]),
      true,
    );
    expect(视图.左.行差异).toEqual([true, false]);
    expect(视图.左.行[0].map((格) => 格.差异)).toEqual([false, true]);
    expect(视图.右.行[0].map((格) => 格.差异)).toEqual([false, true]);
  });

  it("ordered：行数不等时多出的行标记为差异行", () => {
    const 视图 = 构造对照(
      集(["a"], [["1"], ["2"]]),
      集(["a"], [["1"]]),
      true,
    );
    expect(视图.左.行差异).toEqual([false, true]);
    expect(视图.右.行差异).toEqual([false]);
  });

  it("非 ordered：行序不同不算差异；多余/缺失行按多重集合定位", () => {
    const 视图 = 构造对照(
      集(["a"], [["2"], ["1"]]),
      集(["a"], [["1"], ["2"]]),
      false,
    );
    expect(视图.左.行差异).toEqual([false, false]);
    expect(视图.右.行差异).toEqual([false, false]);

    const 视图2 = 构造对照(
      集(["a"], [["1"], ["1"], ["3"]]),
      集(["a"], [["1"], ["2"]]),
      false,
    );
    // 学生多出一个 "1" 和一个 "3"，缺 "2"
    expect(视图2.左.行差异).toEqual([false, true, true]);
    expect(视图2.右.行差异).toEqual([false, true]);
  });

  it("重复行严格计数：两个 1 对两个 1 不差异，一个则差异", () => {
    const 等 = 构造对照(集(["a"], [["1"], ["1"]]), 集(["a"], [["1"], ["1"]]), false);
    expect(等.左.行差异).toEqual([false, false]);
    const 不等 = 构造对照(集(["a"], [["1"]]), 集(["a"], [["1"], ["1"]]), false);
    expect(不等.右.行差异).toEqual([false, true]);
  });

  it("NULL 与空串严格区分", () => {
    const 视图 = 构造对照(集(["a"], [[""]]), 集(["a"], [[null]]), true);
    expect(视图.左.行[0][0].差异).toBe(true);
  });

  it("对侧没有的列标记列差异", () => {
    const 视图 = 构造对照(
      集(["a", "extra"], [["1", "e"]]),
      集(["a"], [["1"]]),
      false,
    );
    expect(视图.左.列差异).toEqual([false, true]);
    expect(视图.右.列差异).toEqual([false]);
  });

  it("超过前N行截断展示，但差异基于完整结果集", () => {
    const 学 = 集(["a"], Array.from({ length: 12 }, (_, i) => [String(i)]));
    const 预 = 集(["a"], Array.from({ length: 12 }, (_, i) => [String(i === 11 ? "X" : i)]));
    const 视图 = 构造对照(学, 预, true, 10);
    expect(视图.截断说明).toContain("前 10 行");
    expect(视图.左.行.length).toBe(10);
  });
});
