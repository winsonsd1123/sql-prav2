// 接缝：域包生成提示词组装（票 #59）——纯函数，校验提示词把 #56 契约约束、
// 占位符语法与教师输入（描述/难度 SQL 样例/表数意愿）完整带给 LLM，
// 且满足 DeepSeek JSON 输出模式的要求（prompt 含「json」字样并给出输出格式示例）。
import { describe, expect, it } from "vitest";
import { buildDomainPackPrompt } from "@/server/domain-pack-prompt";

describe("buildDomainPackPrompt", () => {
  it("系统提示词完整嵌入契约约束：表数 3-5、模板 25-35、五档定义、知识点清单、演练配置、占位符语法", () => {
    const { system } = buildDomainPackPrompt({ description: "图书馆借阅场景" });
    expect(system).toContain("3-5");
    expect(system).toContain("25-35");
    expect(system).toContain("difficultyTiers");
    expect(system).toContain("knowledgeAreas");
    expect(system).toContain("practiceConfig");
    expect(system).toContain("{{table.");
    expect(system).toContain("{{col.");
    expect(system).toContain("{{param.");
    expect(system).toContain("valuePool");
    expect(system).toContain("reference");
    expect(system).toContain("hints");
  });

  it("满足 DeepSeek JSON 输出模式前提：含「json」字样且给出输出格式说明", () => {
    const { system } = buildDomainPackPrompt({ description: "图书馆借阅场景" });
    expect(/json/i.test(system)).toBe(true);
    expect(system).toContain("packId");
    expect(system).toContain("schemaSkeleton");
  });

  it("用户提示词承载教师输入：场景描述、可选难度 SQL 样例、表数意愿", () => {
    const { user } = buildDomainPackPrompt({
      description: "图书馆借阅场景：读者、图书、借阅记录",
      sampleSql: "SELECT 读者姓名 FROM 借阅记录 JOIN 读者 ON ...",
      tableCount: 3,
    });
    expect(user).toContain("图书馆借阅场景");
    expect(user).toContain("SELECT 读者姓名");
    expect(user).toContain("3");
  });

  it("可选输入缺省时用户提示词不出现对应栏目", () => {
    const { user } = buildDomainPackPrompt({ description: "仓库出入库场景" });
    expect(user).toContain("仓库出入库场景");
    expect(user).not.toContain("难度 SQL 样例");
    expect(user).not.toContain("期望表数");
  });
});
