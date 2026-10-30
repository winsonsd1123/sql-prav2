import { describe, expect, it } from "vitest";
import { buildComparison } from "@/components/comparison";
import type { ResultSet } from "@/kernel/types";

const mkResultSet = (columns: string[], rows: (string | null)[][]): ResultSet => ({ columns, rows });

describe("差异对照构造", () => {
  it("完全一致：无差异标记", () => {
    const view = buildComparison(mkResultSet(["a", "b"], [["1", "x"]]), mkResultSet(["a", "b"], [["1", "x"]]), false);
    expect(view.left.rowDiff).toEqual([false]);
    expect(view.right.rowDiff).toEqual([false]);
    expect(view.left.rows[0].every((格) => !格.diff)).toBe(true);
    expect(view.truncationNote).toBeNull();
  });

  it("列序不同但列名相同：学生侧按预期列名重排，不算差异", () => {
    const view = buildComparison(
      mkResultSet(["b", "a"], [["x", "1"]]),
      mkResultSet(["a", "b"], [["1", "x"]]),
      false,
    );
    expect(view.left.columns).toEqual(["a", "b"]);
    expect(view.left.columnDiff).toEqual([false, false]);
    expect(view.left.rowDiff).toEqual([false]);
  });

  it("ordered：按位置比对并定位差异单元格", () => {
    const view = buildComparison(
      mkResultSet(["a", "b"], [["1", "x"], ["2", "y"]]),
      mkResultSet(["a", "b"], [["1", "z"], ["2", "y"]]),
      true,
    );
    expect(view.left.rowDiff).toEqual([true, false]);
    expect(view.left.rows[0].map((格) => 格.diff)).toEqual([false, true]);
    expect(view.right.rows[0].map((格) => 格.diff)).toEqual([false, true]);
  });

  it("ordered：行数不等时多出的行标记为差异行", () => {
    const view = buildComparison(
      mkResultSet(["a"], [["1"], ["2"]]),
      mkResultSet(["a"], [["1"]]),
      true,
    );
    expect(view.left.rowDiff).toEqual([false, true]);
    expect(view.right.rowDiff).toEqual([false]);
  });

  it("非 ordered：行序不同不算差异；多余/缺失行按多重集合定位", () => {
    const view = buildComparison(
      mkResultSet(["a"], [["2"], ["1"]]),
      mkResultSet(["a"], [["1"], ["2"]]),
      false,
    );
    expect(view.left.rowDiff).toEqual([false, false]);
    expect(view.right.rowDiff).toEqual([false, false]);

    const view2 = buildComparison(
      mkResultSet(["a"], [["1"], ["1"], ["3"]]),
      mkResultSet(["a"], [["1"], ["2"]]),
      false,
    );
    // 学生多出一个 "1" 和一个 "3"，缺 "2"
    expect(view2.left.rowDiff).toEqual([false, true, true]);
    expect(view2.right.rowDiff).toEqual([false, true]);
  });

  it("重复行严格计数：两个 1 对两个 1 不差异，一个则差异", () => {
    const equal = buildComparison(mkResultSet(["a"], [["1"], ["1"]]), mkResultSet(["a"], [["1"], ["1"]]), false);
    expect(equal.left.rowDiff).toEqual([false, false]);
    const unequal = buildComparison(mkResultSet(["a"], [["1"]]), mkResultSet(["a"], [["1"], ["1"]]), false);
    expect(unequal.right.rowDiff).toEqual([false, true]);
  });

  it("NULL 与空串严格区分", () => {
    const view = buildComparison(mkResultSet(["a"], [[""]]), mkResultSet(["a"], [[null]]), true);
    expect(view.left.rows[0][0].diff).toBe(true);
  });

  it("对侧没有的列标记列差异", () => {
    const view = buildComparison(
      mkResultSet(["a", "extra"], [["1", "e"]]),
      mkResultSet(["a"], [["1"]]),
      false,
    );
    expect(view.left.columnDiff).toEqual([false, true]);
    expect(view.right.columnDiff).toEqual([false]);
  });

  it("超过前N行截断展示，但差异基于完整结果集", () => {
    const student = mkResultSet(["a"], Array.from({ length: 12 }, (_, i) => [String(i)]));
    const expected = mkResultSet(["a"], Array.from({ length: 12 }, (_, i) => [String(i === 11 ? "X" : i)]));
    const view = buildComparison(student, expected, true, 10);
    expect(view.truncationNote).toContain("前 10 行");
    expect(view.left.rows.length).toBe(10);
  });
});
