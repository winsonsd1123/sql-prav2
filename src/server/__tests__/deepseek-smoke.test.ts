// 真实 DeepSeek 冒烟（票 #59 AC）：有 DEEPSEEK_API_KEY 才跑，缺 key 整文件跳过（不伪造结果、不静默）。
// 跑法：DEEPSEEK_API_KEY=sk-xxx pnpm vitest run --silent=false src/server/__tests__/deepseek-smoke.test.ts
// （--silent=false 必须：vitest 默认吞 console，闸门结论与草稿 packId 都在 [冒烟] 日志里，缺了它等于白跑一次真实调用）
// 结论记录在票 #59 与施工记录（issues/2026-11-01-*.md）。
import { describe, expect, it } from "vitest";
import { resolveDeepSeekProvider } from "@/server/llm-provider";
import { buildDomainPackPrompt } from "@/server/domain-pack-prompt";
import { validateDomainPack, formatGateReport } from "@/kernel/domain-pack-gate";

const hasKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());

describe.skipIf(!hasKey)("真实 DeepSeek 冒烟（生成域包草稿并过闸门）", () => {
  it("小表数描述 → 草稿 JSON → 闸门结论输出", { timeout: 240_000 }, async () => {
    const provider = resolveDeepSeekProvider();
    expect(provider).not.toBeNull();
    const prompt = buildDomainPackPrompt({
      description: "小型电商订单场景：用户、商品、订单（订单引用用户与商品），中文业务值",
      tableCount: 3,
    });
    const completion = await provider!.completeJson(prompt);
    const draft = JSON.parse(completion) as unknown;
    console.log(`[冒烟] 模型 ${provider!.model}，草稿 packId = ${(draft as { packId?: string }).packId}`);
    const report = await validateDomainPack(draft);
    console.log(`[冒烟] 闸门结论 passed = ${report.passed}\n${formatGateReport(report)}`);
    // 冒烟不强制一次过闸门（LLM 质量问题正是闸门要暴露的），只断言调用与闸门链路真实走通
    expect(report).toHaveProperty("passed");
  });
});
