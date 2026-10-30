import type { JudgeResult, Session, QuestionInstance } from "./types";
import { executeQuery, sanitizeStatement } from "./execute";
import { isResultEquivalent } from "./equivalence";
import { validateSyntax, validateGroupBy, mapRuntimeError, formatError } from "./error-mapping";
import { RESULT_ROW_LIMIT, GuardLimitError } from "./guard";

/**
 * 判定（判题内核接缝之二）：学生SQL + 会话 + 题目实例 → 判定结果。
 * 依据结果集比对而非文本比对；错误经映射层产出 MySQL 三要素（1064 前置语法校验 + 运行时映射）。
 * 时刻为判定级常量：入口生成一次，学生 SQL 与参考答案的两次执行共享，
 * 保证 NOW()/CURDATE() 在同一次判定内一致（可显式传入以便测试）。
 */
export async function judge(
  studentSql: string,
  session: Session,
  question: QuestionInstance,
  rowLimit: number = RESULT_ROW_LIMIT,
  time: Date = new Date(),
): Promise<JudgeResult> {
  const sanitized = sanitizeStatement(studentSql);
  if (!sanitized.ok) {
    // 语法错误优先于产品拦截（如 SELEC 拼错：MySQL 报 1064 而非演练场提示）
    let text = studentSql.trim();
    if (text.endsWith(";")) text = text.slice(0, -1).trimEnd();
    if (text.length === 0) return { judge: "拦截", errorMessage: sanitized.message };
    const syntaxError = validateSyntax(text);
    if (syntaxError) {
      return { judge: "错误", errorCode: syntaxError.errorCode, SQLSTATE: syntaxError.SQLSTATE, errorMessage: formatError(syntaxError) };
    }
    return { judge: "拦截", errorMessage: sanitized.message };
  }

  const syntaxError = validateSyntax(sanitized.statement);
  if (syntaxError) {
    return { judge: "错误", errorCode: syntaxError.errorCode, SQLSTATE: syntaxError.SQLSTATE, errorMessage: formatError(syntaxError) };
  }

  // ONLY_FULL_GROUP_BY 静态检查（插在语法校验后、执行前）
  const groupByError = validateGroupBy(sanitized.statement, session.database.tables.map((t) => ({ tableName: t.tableName, columnNames: t.columnNames })));
  if (groupByError) {
    return { judge: "错误", errorCode: groupByError.errorCode, SQLSTATE: groupByError.SQLSTATE, errorMessage: formatError(groupByError) };
  }

  let studentResult;
  let expectedResult;
  try {
    studentResult = await executeQuery(sanitized.statement, session, rowLimit, time);
    expectedResult = await executeQuery(question.referenceAnswer, session, rowLimit, time);
  } catch (e) {
    // 防护触发（issue #10）：产品级提示，不伪装成 MySQL 错误
    if (e instanceof GuardLimitError) {
      return { judge: "拦截", errorMessage: e.message };
    }
    const mapped = mapRuntimeError(e instanceof Error ? e.message : String(e), sanitized.statement);
    return { judge: "错误", errorCode: mapped.errorCode, SQLSTATE: mapped.SQLSTATE, errorMessage: formatError(mapped) };
  }

  if (isResultEquivalent(studentResult, expectedResult, question.ordered)) {
    return { judge: "通过" };
  }
  return { judge: "不通过", studentResult, expectedResult };
}
