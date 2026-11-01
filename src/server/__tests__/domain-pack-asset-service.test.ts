// 接缝：云端域包写入路径（票 #57）——入库前过验证闸门（强校验：结构/生成/自判），
// 通过才 upsert 到 domain_pack_asset；闸门拒绝或落库失败都不产生「半入库」状态。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkCloudPackJson } from "@/kernel/__tests__/fixtures/cloud-domain-pack";
import { upsertDomainPackAsset } from "@/server/domain-pack-asset-service";

/** 结构化 Supabase 写客户端桩：只记录 upsert 调用，可控返回 */
function mkClient(overrides: { error?: unknown } = {}) {
  const upsertMock = vi.fn().mockResolvedValue({ error: null, ...overrides });
  const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });
  return { client: { from: fromMock }, fromMock, upsertMock };
}

beforeEach(() => vi.clearAllMocks());

describe("云端域包写入路径 upsertDomainPackAsset", () => {
  it("闸门拒绝的域包不落库，返回结构化闸门报告", async () => {
    const { client, upsertMock } = mkClient();
    // 模板数不足 25：契约（结构检查）即拒
    const templates = mkCloudPackJson().templates as unknown[];
    const result = await upsertDomainPackAsset(client, mkCloudPackJson({ templates: templates.slice(0, 10) }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "gate") {
      expect(result.report.passed).toBe(false);
    } else {
      throw new Error("应返回闸门拒绝结果");
    }
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("闸门通过的域包 upsert 到 domain_pack_asset（pack_id + 完整资产 JSON）", async () => {
    const { client, upsertMock } = mkClient();
    const json = mkCloudPackJson();
    const result = await upsertDomainPackAsset(client, json);
    expect(result.ok).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][0]).toEqual({ pack_id: "cloud-fixture-pack", asset: json });
  });

  it("落库失败原样透出错误信息，不吞异常", async () => {
    const { client } = mkClient({ error: { message: "rls denied" } });
    const result = await upsertDomainPackAsset(client, mkCloudPackJson());
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "storage") {
      expect(result.message).toContain("rls denied");
    } else {
      throw new Error("应返回落库失败结果");
    }
  });
});
