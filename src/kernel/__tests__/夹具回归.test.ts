import { describe, it, expect } from "vitest";
import 夹具JSON from "./fixtures/MySQL错误夹具.json";
import { 生成 } from "../generate";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";
import { 判定 } from "../judge";

/**
 * 夹具回归（错误保真度验收基准）：
 * 同一批错误 SQL 打入判题内核，输出三要素与 MySQL 采样夹具逐项断言。
 * 改动映射逻辑破坏保真度时，本文件必须变红。
 */
const 夹具 = 夹具JSON as {
  样本: { id: string; sql: string; 错误码: number; sqlstate: string; 文案: string }[];
};

describe("错误保真度夹具回归", () => {
  const 会话 = 生成(42, 加载域包A());
  const 题目 = 会话.题目[0];

  for (const 样本 of 夹具.样本) {
    it(`${样本.id} → ERROR ${样本.错误码} (${样本.sqlstate})`, async () => {
      const 结果 = await 判定(样本.sql, 会话, 题目);
      expect(结果.判定).toBe("错误");
      if (结果.判定 !== "错误") return;
      expect(结果.错误码).toBe(样本.错误码);
      expect(结果.SQLSTATE).toBe(样本.sqlstate);
      expect(结果.错误信息).toBe(`ERROR ${样本.错误码} (${样本.sqlstate}): ${样本.文案}`);
    });
  }
});
