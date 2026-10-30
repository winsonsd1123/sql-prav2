import { describe, expect, it } from "vitest";
import { generateSession } from "@/kernel/generate";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";

describe("会话生成的确定性（seed → packA → session）", () => {
  const pack = loadPackA();

  it("同一种子多次生成，会话的字节级序列化完全一致", () => {
    const a = JSON.stringify(generateSession(20260101, pack));
    const b = JSON.stringify(generateSession(20260101, pack));
    expect(a).toBe(b);
  });

  it("不同种子生成的会话不同", () => {
    const a = JSON.stringify(generateSession(20260101, pack));
    const b = JSON.stringify(generateSession(20260202, pack));
    expect(a).not.toBe(b);
  });

  it("会话包含域包A的三张表与全量题目实例", () => {
    const session = generateSession(20260101, pack);
    expect(session.database.tables).toHaveLength(3); // T5 起表名为实例化的实际名，池归属由 随机化.test.ts 覆盖
    expect(session.questions).toHaveLength(pack.templates.length);
  });
});
