import type { 结果集 } from "./types";

/**
 * 结果等价（GLOSSARY）：行序按题目 ordered 开关敏感/不敏感；
 * 列序、列名不敏感；重复行按多重集合严格计数；
 * NULL、空串、数值/字符串严格区分（已在显示值规范化中编码类型）。
 */
export function 结果等价(学生: 结果集, 预期: 结果集, ordered: boolean): boolean {
  if (学生.行.length !== 预期.行.length) return false;
  if (学生.行.length > 0 && 学生.行[0].length !== 预期.行[0].length) return false;
  // 列序不敏感：行内按显示值排序后比较
  const 规范行 = (行: (string | null)[]) => [...行].sort().join("");
  if (ordered) {
    return 学生.行.every((行, i) => 规范行(行) === 规范行(预期.行[i]));
  }
  const 计数 = new Map<string, number>();
  for (const 行 of 预期.行) 计数.set(规范行(行), (计数.get(规范行(行)) ?? 0) + 1);
  for (const 行 of 学生.行) {
    const 键 = 规范行(行);
    const n = 计数.get(键) ?? 0;
    if (n === 0) return false;
    计数.set(键, n - 1);
  }
  return true;
}
