// "你的结果 / 预期结果"差异对照的纯数据构造（issue #9）。
// 判题等价规则：列名/列序不敏感、行序仅在 ordered 时敏感；对照视图按同一规则对齐，
// 使差异行/列可定位：ordered 按位置比对到单元格；非 ordered 按多重集合找出多出/缺失的行。

import type { ResultSet, DisplayValue } from "@/kernel/types";

export interface ComparisonCell {
  value: DisplayValue;
  /** 该单元格与对侧同位值不等 */
  diff: boolean;
}

export interface ComparisonSideView {
  columns: string[];
  /** 列差异：该列在对侧没有对应列（按列名匹配） */
  columnDiff: boolean[];
  rows: ComparisonCell[][];
  /** 行差异：该行是对侧缺失（或含差异单元格）的行 */
  rowDiff: boolean[];
}

export interface ComparisonView {
  left: ComparisonSideView; // 你的结果
  right: ComparisonSideView; // 预期结果
  /** 任一侧行数超过展示上限、被截断时的说明，未截断为 null */
  truncationNote: string | null;
}

const rowKey = (row: DisplayValue[]): string => JSON.stringify(row);

/**
 * 构造并排对照视图。rowLimit = 展示的行数上限；差异判定在完整结果集上计算后再截断，
 * 保证截断不影响差异定位的正确性。
 */
export function buildComparison(student: ResultSet, expected: ResultSet, ordered: boolean, rowLimit = 10): ComparisonView {
  // 1) 列对齐：按列名把学生列映射到预期列（列名不敏感）；未匹配的列留在末尾并标差异。
  const expectedColumnIndex = new Map(expected.columns.map((name, j) => [name, j]));
  const studentToExpected = new Array(student.columns.length).fill(-1);
  const occupied = new Array(expected.columns.length).fill(false);
  student.columns.forEach((name, i) => {
    const j = expectedColumnIndex.get(name);
    if (j !== undefined && !occupied[j]) {
      studentToExpected[i] = j;
      occupied[j] = true;
    }
  });
  // 重排后的学生侧：预期列顺序在前，未匹配的学生列殿后
  const aligned = studentToExpected.map((j, i) => ({ j, i })).filter((x) => x.j >= 0).sort((a, b) => a.j - b.j);
  const trailing = studentToExpected.map((j, i) => ({ j, i })).filter((x) => x.j < 0);
  const studentColumnOrder = [...aligned, ...trailing].map((x) => x.i);

  const leftColumns = studentColumnOrder.map((i) => student.columns[i]);
  const leftRows = student.rows.map((row) => studentColumnOrder.map((i) => row[i]));
  const rightColumns = expected.columns;
  const rightRows = expected.rows;

  const rightColumnDiff = occupied.map((used) => !used);
  const leftColumnDiff = studentColumnOrder.map((_, position) => position >= aligned.length);

  const leftRowDiff: boolean[] = [];
  const rightRowDiff: boolean[] = [];
  const leftMarks: (boolean[] | null)[] = []; // 每行的单元格差异（有序比对时才有）
  const rightMarks: (boolean[] | null)[] = [];

  if (ordered) {
    const rowCount = Math.max(leftRows.length, rightRows.length);
    for (let i = 0; i < rowCount; i++) {
      const a = leftRows[i];
      const b = rightRows[i];
      if (a === undefined || b === undefined) {
        leftRowDiff.push(a !== undefined);
        rightRowDiff.push(b !== undefined);
        leftMarks.push(a !== undefined ? null : []);
        rightMarks.push(b !== undefined ? null : []);
        continue;
      }
      const width = Math.max(a.length, b.length);
      const cellDiffs = Array.from({ length: width }, (_, j) => !valuesEqual(a[j] ?? null, b[j] ?? null));
      const rowDiffers = cellDiffs.some(Boolean);
      leftRowDiff.push(rowDiffers);
      rightRowDiff.push(rowDiffers);
      leftMarks.push(rowDiffers ? cellDiffs.slice(0, a.length) : null);
      rightMarks.push(rowDiffers ? cellDiffs.slice(0, b.length) : null);
    }
  } else {
    // 行序不敏感：按多重集合计数，找出学生侧多出的行与预期侧缺失的行
    const originalCounts = new Map<string, number>();
    for (const row of rightRows) originalCounts.set(rowKey(row), (originalCounts.get(rowKey(row)) ?? 0) + 1);
    const remaining = new Map(originalCounts);
    for (const row of leftRows) {
      const key = rowKey(row);
      const remainingCount = remaining.get(key) ?? 0;
      if (remainingCount > 0) remaining.set(key, remainingCount - 1);
      leftRowDiff.push(remainingCount > 0 ? false : true);
      leftMarks.push(null);
    }
    // 预期侧：每个键前 matched 个实例视为已匹配，其余为缺失行
    const matched = new Map([...originalCounts].map(([key, count]) => [key, count - (remaining.get(key) ?? 0)]));
    const occurrenceIndex = new Map<string, number>();
    for (const row of rightRows) {
      const key = rowKey(row);
      const occurrence = (occurrenceIndex.get(key) ?? 0) + 1;
      occurrenceIndex.set(key, occurrence);
      rightRowDiff.push(occurrence <= (matched.get(key) ?? 0) ? false : true);
      rightMarks.push(null);
    }
  }

  // ordered 比对按 max(行数) 推入标记，裁齐到各自行数（多余行为截断展示外的占位）
  leftRowDiff.length = leftRows.length;
  rightRowDiff.length = rightRows.length;
  leftMarks.length = leftRows.length;
  rightMarks.length = rightRows.length;

  const truncated = leftRows.length > rowLimit || rightRows.length > rowLimit;
  const sliceView = (rows: DisplayValue[][], marks: (boolean[] | null)[]) =>
    rows.slice(0, rowLimit).map((r, i) => {
      const cellMarks = marks[i];
      return r.map((value, j) => ({ value, diff: cellMarks !== null && cellMarks[j] === true }));
    });

  return {
    left: {
      columns: leftColumns,
      columnDiff: leftColumnDiff,
      rowDiff: leftRowDiff.slice(0, rowLimit),
      rows: sliceView(leftRows, leftMarks),
    },
    right: {
      columns: rightColumns,
      columnDiff: rightColumnDiff,
      rowDiff: rightRowDiff.slice(0, rowLimit),
      rows: sliceView(rightRows, rightMarks),
    },
    truncationNote: truncated
      ? `结果超过 ${rowLimit} 行，仅对照前 ${rowLimit} 行（差异统计基于完整结果集）`
      : null,
  };
}

/** 与判题一致的显示值相等：NULL/空串/类型严格区分 */
function valuesEqual(a: DisplayValue, b: DisplayValue): boolean {
  return a === b;
}
