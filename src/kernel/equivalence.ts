import type { ResultSet } from "./types";

/**
 * 结果等价（GLOSSARY）：行序按题目 ordered 开关敏感/不敏感；
 * 列序、列名不敏感；重复行按多重集合严格计数；
 * NULL、空串、数值/字符串严格区分（已在显示值规范化中编码类型）。
 */
export function isResultEquivalent(student: ResultSet, expected: ResultSet, ordered: boolean): boolean {
  if (student.rows.length !== expected.rows.length) return false;
  if (student.rows.length > 0 && student.rows[0].length !== expected.rows[0].length) return false;
  // 列序不敏感：行内按显示值排序后比较
  const canonicalRow = (row: (string | null)[]) => [...row].sort().join("");
  if (ordered) {
    return student.rows.every((row, i) => canonicalRow(row) === canonicalRow(expected.rows[i]));
  }
  const counts = new Map<string, number>();
  for (const row of expected.rows) counts.set(canonicalRow(row), (counts.get(canonicalRow(row)) ?? 0) + 1);
  for (const row of student.rows) {
    const key = canonicalRow(row);
    const n = counts.get(key) ?? 0;
    if (n === 0) return false;
    counts.set(key, n - 1);
  }
  return true;
}
