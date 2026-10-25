import type { 判定结果, 会话, 题目实例 } from "./types";
import { 执行查询, 清洗语句 } from "./execute";
import { 结果等价 } from "./equivalence";
import { 校验语法, 校验分组, 映射运行时错误, 格式化 } from "./错误映射";
import { 结果行数上限, 防护超限错误 } from "./防护";

/**
 * 判定（判题内核接缝之二）：学生SQL + 会话 + 题目实例 → 判定结果。
 * 依据结果集比对而非文本比对；错误经映射层产出 MySQL 三要素（1064 前置语法校验 + 运行时映射）。
 */
export async function 判定(
  学生SQL: string,
  会话: 会话,
  题目: 题目实例,
  行数上限: number = 结果行数上限,
): Promise<判定结果> {
  const 清洗 = 清洗语句(学生SQL);
  if (!清洗.ok) {
    // 语法错误优先于产品拦截（如 SELEC 拼错：MySQL 报 1064 而非演练场提示）
    let 文本 = 学生SQL.trim();
    if (文本.endsWith(";")) 文本 = 文本.slice(0, -1).trimEnd();
    if (文本.length === 0) return { 判定: "拦截", 错误信息: 清洗.提示 };
    const 语法错误 = 校验语法(文本);
    if (语法错误) {
      return { 判定: "错误", 错误码: 语法错误.错误码, SQLSTATE: 语法错误.SQLSTATE, 错误信息: 格式化(语法错误) };
    }
    return { 判定: "拦截", 错误信息: 清洗.提示 };
  }

  const 语法错误 = 校验语法(清洗.语句);
  if (语法错误) {
    return { 判定: "错误", 错误码: 语法错误.错误码, SQLSTATE: 语法错误.SQLSTATE, 错误信息: 格式化(语法错误) };
  }

  // ONLY_FULL_GROUP_BY 静态检查（插在语法校验后、执行前）
  const 分组错误 = 校验分组(清洗.语句, 会话.库.表.map((t) => ({ 表名: t.表名, 列名: t.列名 })));
  if (分组错误) {
    return { 判定: "错误", 错误码: 分组错误.错误码, SQLSTATE: 分组错误.SQLSTATE, 错误信息: 格式化(分组错误) };
  }

  let 学生结果;
  let 预期结果;
  try {
    学生结果 = await 执行查询(清洗.语句, 会话, 行数上限);
    预期结果 = await 执行查询(题目.参考答案, 会话, 行数上限);
  } catch (e) {
    // 防护触发（issue #10）：产品级提示，不伪装成 MySQL 错误
    if (e instanceof 防护超限错误) {
      return { 判定: "拦截", 错误信息: e.message };
    }
    const 映射 = 映射运行时错误(e instanceof Error ? e.message : String(e), 清洗.语句);
    return { 判定: "错误", 错误码: 映射.错误码, SQLSTATE: 映射.SQLSTATE, 错误信息: 格式化(映射) };
  }

  if (结果等价(学生结果, 预期结果, 题目.ordered)) {
    return { 判定: "通过" };
  }
  return { 判定: "不通过", 学生结果, 预期结果 };
}
