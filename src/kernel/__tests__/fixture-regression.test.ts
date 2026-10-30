import { describe, it, expect } from "vitest";
import fixtureJson from "./fixtures/mysql-error-fixtures.json";
import { generateSession } from "../generate";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";
import { judge } from "../judge";

/**
 * 夹具回归（错误保真度验收基准）：
 * 同一批错误 SQL 打入判题内核，输出三要素与 MySQL 采样夹具逐项断言。
 * 改动映射逻辑破坏保真度时，本文件必须变红。
 *
 * T5 引入表名/列名随机化后，夹具样本按语义角色名（学生/课程/成绩/姓名…）书写，
 * seed=42 会话的实例名不再与角色名一致。因此测试从会话实例反查实际名，
 * 把样本 SQL 与期望文案中的角色名统一代入为实例名后再触发与断言——
 * 断言强度不变（三要素 + 文案逐字），且对任意种子免疫。
 */
const fixture = fixtureJson as {
  样本: { id: string; sql: string; 错误码: number; sqlstate: string; 文案: string }[];
};

/** 标识符边界：\b 对中文不成立，用「非标识符字符或结尾」断言（与映射层同规则） */
const wordBoundary = "(?![A-Za-z0-9_$\\u4e00-\\u9fff])";

describe("错误保真度夹具回归", () => {
  const pack = loadPackA();
  const session = generateSession(42, pack);
  const question = session.questions[0];

  // 角色名 → 实例名映射：按库骨架与实例表的对位关系反查
  const actualNames = new Map<string, string>();
  pack.schemaSkeleton.forEach((skeletonTable, i) => {
    const instanceTable = session.database.tables[i];
    actualNames.set(skeletonTable.tableRole, instanceTable.tableName);
    // 序列主键列在实例列首位，其余列按定义顺序对位
    const roleColumns = [skeletonTable.serialKey?.columnRole, ...skeletonTable.columns.map((c) => c.columnRole)].filter(
      (x): x is string => x !== undefined,
    );
    roleColumns.forEach((role, j) => {
      if (!actualNames.has(role)) actualNames.set(role, instanceTable.columnNames[j]);
    });
  });

  /** 把文本中的角色名代入为会话实例名（长名优先，避免前缀吞并） */
  const substitute = (text: string): string => {
    let result = text;
    for (const role of [...actualNames.keys()].sort((a, b) => b.length - a.length)) {
      const instance = actualNames.get(role)!;
      if (role === instance) continue;
      result = result.replace(new RegExp(`${role}${wordBoundary}`, "g"), instance);
    }
    return result;
  };

  for (const sample of fixture.样本) {
    it(`${sample.id} → ERROR ${sample.错误码} (${sample.sqlstate})`, async () => {
      const result = await judge(substitute(sample.sql), session, question);
      expect(result.judge).toBe("错误");
      if (result.judge !== "错误") return;
      expect(result.errorCode).toBe(sample.错误码);
      expect(result.SQLSTATE).toBe(sample.sqlstate);
      expect(result.errorMessage).toBe(
        `ERROR ${sample.错误码} (${sample.sqlstate}): ${substitute(sample.文案)}`,
      );
    });
  }
});
