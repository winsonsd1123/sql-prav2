import type { 判定结果, 会话, 题目实例 } from "./types";
import { 执行查询, 清洗语句 } from "./execute";
import { 结果等价 } from "./equivalence";

/**
 * 判定（判题内核接缝之二）：学生SQL + 会话 + 题目实例 → 判定结果。
 * 依据结果集比对而非文本比对；错误暂直通 SQLite 原文（映射为后续票）。
 */
export async function 判定(
  学生SQL: string,
  会话: 会话,
  题目: 题目实例,
): Promise<判定结果> {
  const 清洗 = 清洗语句(学生SQL);
  if (!清洗.ok) return { 判定: "拦截", 错误信息: 清洗.提示 };

  let 学生结果;
  let 预期结果;
  try {
    学生结果 = await 执行查询(清洗.语句, 会话);
    预期结果 = await 执行查询(题目.参考答案, 会话);
  } catch (e) {
    return { 判定: "错误", 错误信息: e instanceof Error ? e.message : String(e) };
  }

  if (结果等价(学生结果, 预期结果, 题目.ordered)) {
    return { 判定: "通过" };
  }
  return { 判定: "不通过", 学生结果, 预期结果 };
}
