import type { JudgeResult, Session, QuestionInstance } from "./types";
import { 执行查询, 清洗语句 } from "./execute";
import { isResultEquivalent } from "./equivalence";
import { 校验语法, 校验分组, 映射运行时错误, 格式化 } from "./错误映射";
import { 结果行数上限, 防护超限错误 } from "./防护";

/**
 * 判定（判题内核接缝之二）：学生SQL + 会话 + 题目实例 → 判定结果。
 * 依据结果集比对而非文本比对；错误经映射层产出 MySQL 三要素（1064 前置语法校验 + 运行时映射）。
 * 时刻为判定级常量：入口生成一次，学生 SQL 与参考答案的两次执行共享，
 * 保证 NOW()/CURDATE() 在同一次判定内一致（可显式传入以便测试）。
 */
export async function 判定(
  学生SQL: string,
  会话: Session,
  题目: QuestionInstance,
  行数上限: number = 结果行数上限,
  时刻: Date = new Date(),
): Promise<JudgeResult> {
  const 清洗 = 清洗语句(学生SQL);
  if (!清洗.ok) {
    // 语法错误优先于产品拦截（如 SELEC 拼错：MySQL 报 1064 而非演练场提示）
    let 文本 = 学生SQL.trim();
    if (文本.endsWith(";")) 文本 = 文本.slice(0, -1).trimEnd();
    if (文本.length === 0) return { judge: "拦截", errorMessage: 清洗.提示 };
    const 语法错误 = 校验语法(文本);
    if (语法错误) {
      return { judge: "错误", errorCode: 语法错误.错误码, SQLSTATE: 语法错误.SQLSTATE, errorMessage: 格式化(语法错误) };
    }
    return { judge: "拦截", errorMessage: 清洗.提示 };
  }

  const 语法错误 = 校验语法(清洗.语句);
  if (语法错误) {
    return { judge: "错误", errorCode: 语法错误.错误码, SQLSTATE: 语法错误.SQLSTATE, errorMessage: 格式化(语法错误) };
  }

  // ONLY_FULL_GROUP_BY 静态检查（插在语法校验后、执行前）
  const 分组错误 = 校验分组(清洗.语句, 会话.database.tables.map((t) => ({ 表名: t.tableName, 列名: t.columnNames })));
  if (分组错误) {
    return { judge: "错误", errorCode: 分组错误.错误码, SQLSTATE: 分组错误.SQLSTATE, errorMessage: 格式化(分组错误) };
  }

  let 学生结果;
  let 预期结果;
  try {
    学生结果 = await 执行查询(清洗.语句, 会话, 行数上限, 时刻);
    预期结果 = await 执行查询(题目.referenceAnswer, 会话, 行数上限, 时刻);
  } catch (e) {
    // 防护触发（issue #10）：产品级提示，不伪装成 MySQL 错误
    if (e instanceof 防护超限错误) {
      return { judge: "拦截", errorMessage: e.message };
    }
    const 映射 = 映射运行时错误(e instanceof Error ? e.message : String(e), 清洗.语句);
    return { judge: "错误", errorCode: 映射.错误码, SQLSTATE: 映射.SQLSTATE, errorMessage: 格式化(映射) };
  }

  if (isResultEquivalent(学生结果, 预期结果, 题目.ordered)) {
    return { judge: "通过" };
  }
  return { judge: "不通过", studentResult: 学生结果, expectedResult: 预期结果 };
}
