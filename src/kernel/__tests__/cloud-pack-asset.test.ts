import { describe, expect, it } from "vitest";
import { parseDomainPackJson } from "@/kernel/domain-pack-contract";
import { assetToKernelPack } from "@/kernel/domain-pack-contract";
import { validateDomainPack } from "@/kernel/domain-pack-gate";
import { generatePracticeSession } from "@/kernel/question-picking";
import { mkCloudPackJson } from "@/kernel/__tests__/fixtures/cloud-domain-pack";

/**
 * 云端域包夹具与资产转换（票 #57）：夹具是纯 JSON 数据资产，
 * 必须同时满足两个口径——过验证闸门（写入路径强校验的标准）、
 * 转判题内核域包后可直接参与抽题开练（读取路径收录的标准）。
 */

describe("云端域包夹具与资产转换", () => {
  it("夹具过验证闸门（结构/生成/自判全通过）", async () => {
    const report = await validateDomainPack(mkCloudPackJson());
    if (!report.passed) {
      console.warn(JSON.stringify(report, null, 2));
    }
    expect(report.passed).toBe(true);
  });

  it("数据资产转内核域包后可开练：七知识点全覆盖，抽题出 10 题", () => {
    const parsed = parseDomainPackJson(mkCloudPackJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pack = assetToKernelPack(parsed.pack);
    expect(pack.packId).toBe("cloud-fixture-pack");
    expect(pack.templates).toHaveLength(28);
    const session = generatePracticeSession(42, pack);
    expect(session.questions).toHaveLength(10);
  });

  it("转换携带知识点清单与演练配置、不携带难度定义（#58 顺序 / #61 配置抽题）", () => {
    const parsed = parseDomainPackJson(mkCloudPackJson());
    if (!parsed.ok) return;
    const pack = assetToKernelPack(parsed.pack);
    expect(Object.keys(pack)).toEqual(["packId", "name", "schemaSkeleton", "templates", "knowledgeAreas", "practiceConfig"]);
    expect(pack.knowledgeAreas).toEqual(parsed.pack.knowledgeAreas);
    expect(pack.practiceConfig).toEqual(parsed.pack.practiceConfig);
  });
});
