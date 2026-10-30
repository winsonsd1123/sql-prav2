import { describe, it, expect } from "vitest";
import 夹具JSON from "./fixtures/MySQL错误夹具.json";
import { generateSession } from "../generate";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";
import { 判定 } from "../judge";

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
const 夹具 = 夹具JSON as {
  样本: { id: string; sql: string; 错误码: number; sqlstate: string; 文案: string }[];
};

/** 标识符边界：\b 对中文不成立，用「非标识符字符或结尾」断言（与映射层同规则） */
const 边界 = "(?![A-Za-z0-9_$\\u4e00-\\u9fff])";

describe("错误保真度夹具回归", () => {
  const 域包 = 加载域包A();
  const 会话 = generateSession(42, 域包);
  const 题目 = 会话.questions[0];

  // 角色名 → 实例名映射：按库骨架与实例表的对位关系反查
  const 实际名 = new Map<string, string>();
  域包.schemaSkeleton.forEach((骨架表, i) => {
    const 实例表 = 会话.database.tables[i];
    实际名.set(骨架表.tableRole, 实例表.tableName);
    // 序列主键列在实例列首位，其余列按定义顺序对位
    const 角色列 = [骨架表.serialKey?.columnRole, ...骨架表.columns.map((c) => c.columnRole)].filter(
      (x): x is string => x !== undefined,
    );
    角色列.forEach((角色, j) => {
      if (!实际名.has(角色)) 实际名.set(角色, 实例表.columnNames[j]);
    });
  });

  /** 把文本中的角色名代入为会话实例名（长名优先，避免前缀吞并） */
  const 代入 = (文本: string): string => {
    let 结果 = 文本;
    for (const 角色 of [...实际名.keys()].sort((a, b) => b.length - a.length)) {
      const 实例 = 实际名.get(角色)!;
      if (角色 === 实例) continue;
      结果 = 结果.replace(new RegExp(`${角色}${边界}`, "g"), 实例);
    }
    return 结果;
  };

  for (const 样本 of 夹具.样本) {
    it(`${样本.id} → ERROR ${样本.错误码} (${样本.sqlstate})`, async () => {
      const 结果 = await 判定(代入(样本.sql), 会话, 题目);
      expect(结果.judge).toBe("错误");
      if (结果.judge !== "错误") return;
      expect(结果.errorCode).toBe(样本.错误码);
      expect(结果.SQLSTATE).toBe(样本.sqlstate);
      expect(结果.errorMessage).toBe(
        `ERROR ${样本.错误码} (${样本.sqlstate}): ${代入(样本.文案)}`,
      );
    });
  }
});
