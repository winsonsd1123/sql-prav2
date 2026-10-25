import { describe, expect, it } from "vitest";
import { 生成 } from "@/kernel/generate";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";

describe("会话生成的确定性（种子 → 域包A → 会话）", () => {
  const 域包 = 加载域包A();

  it("同一种子多次生成，会话的字节级序列化完全一致", () => {
    const a = JSON.stringify(生成(20260101, 域包));
    const b = JSON.stringify(生成(20260101, 域包));
    expect(a).toBe(b);
  });

  it("不同种子生成的会话不同", () => {
    const a = JSON.stringify(生成(20260101, 域包));
    const b = JSON.stringify(生成(20260202, 域包));
    expect(a).not.toBe(b);
  });

  it("会话包含域包A的三张表与全量题目实例", () => {
    const 会话 = 生成(20260101, 域包);
    expect(会话.库.表).toHaveLength(3); // T5 起表名为实例化的实际名，池归属由 随机化.test.ts 覆盖
    expect(会话.题目).toHaveLength(域包.题目模板.length);
  });
});
