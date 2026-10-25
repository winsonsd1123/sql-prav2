import { describe, expect, it } from "vitest";
import { 生成 } from "@/kernel/generate";
import { 判定 } from "@/kernel/judge";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";

const 会话 = 生成(20260101, 加载域包A());

/** 列序颠倒的正确变体：把参考答案 SELECT 后的列清单反转（括号内的逗号不属于列分隔） */
function 列序颠倒(sql: string): string {
  const m = sql.match(/^select\s+(.+?)\s+from\s+(.+)$/i);
  if (!m) return sql;
  let 深度 = 0;
  const 项: string[] = [];
  let 当前 = "";
  for (const ch of m[1]) {
    if (ch === "(") 深度++;
    if (ch === ")") 深度--;
    if (ch === "," && 深度 === 0) {
      项.push(当前.trim());
      当前 = "";
    } else 当前 += ch;
  }
  项.push(当前.trim());
  if (项.length < 2) return sql;
  return `SELECT ${项.reverse().join(", ")} FROM ${m[2]}`;
}

describe("每个题目模板的判题等价", () => {
  it.each(会话.题目.map((题目) => [题目.模板ID, 题目]))(
    "模板 %s 的参考答案自判必须通过",
    async (_id, 题目) => {
      const 结果 = await 判定(题目.参考答案, 会话, 题目);
      expect(结果.判定).toBe("通过");
    },
  );

  it.each(会话.题目.map((题目) => [题目.模板ID, 题目]))(
    "模板 %s 的列序颠倒变体必须通过",
    async (_id, 题目) => {
      const 变体 = 列序颠倒(题目.参考答案);
      if (变体 === 题目.参考答案) return; // 单列查询无变体
      const 结果 = await 判定(变体, 会话, 题目);
      expect(结果.判定).toBe("通过");
    },
  );

  it("错误写法必须不通过（缺 DISTINCT）", async () => {
    const 题目 = 会话.题目.find((q) => q.模板ID.includes("distinct"));
    const 不去重 = 题目!.参考答案.replace(/distinct\s+/i, "");
    const 结果 = await 判定(不去重, 会话, 题目!);
    expect(结果.判定).toBe("不通过");
  });

  it("多条语句被演练场产品提示拦截", async () => {
    const 题目 = 会话.题目[0];
    const 结果 = await 判定("SELECT 1; SELECT 2", 会话, 题目);
    expect(结果.判定).toBe("拦截");
    if (结果.判定 !== "拦截") return;
    // 产品提示为中文、说明演练场范围规则，且不伪装成 MySQL 错误格式
    expect(结果.错误信息).toContain("演练场仅接受单条 SELECT 查询语句");
    expect(结果.错误信息).not.toMatch(/^ERROR \d+ \(\w+\):/);
  });

  it.each(["INSERT INTO 学生 VALUES (1, 'x')", "UPDATE 学生 SET 姓名 = 'x'", "DELETE FROM 学生", "DROP TABLE 学生", "CREATE TABLE t (a INT)"])(
    "非 SELECT 语句被拦截并得到中文产品提示：%s",
    async (SQL) => {
      const 题目 = 会话.题目[0];
      const 结果 = await 判定(SQL, 会话, 题目);
      expect(结果.判定).toBe("拦截");
      if (结果.判定 !== "拦截") return;
      expect(结果.错误信息).toContain("演练场仅接受单条 SELECT 查询语句");
      expect(结果.错误信息).not.toMatch(/^ERROR \d+ \(\w+\):/);
    },
  );

  it("容忍单个尾分号", async () => {
    const 题目 = 会话.题目[0];
    const 结果 = await 判定(题目.参考答案 + ";", 会话, 题目);
    expect(结果.判定).toBe("通过");
  });

  it("SQLite 语法错误原文直通", async () => {
    const 题目 = 会话.题目[0];
    const 结果 = await 判定("SELECT FORM 学生", 会话, 题目);
    expect(结果.判定).toBe("错误");
    if (结果.判定 === "错误") expect(结果.错误信息.length).toBeGreaterThan(0);
  });
});
