// 接缝：云端域包写入路径（票 #57；#83 扩展词表引用形态校验）——入库前过验证闸门
// （强校验：结构/生成/自判），引用形态再过词表语义校验（引用存在 / 名称与词表逐位对齐 /
// 新增引用不可指向停用条目），通过才 upsert 到 domain_pack_asset；
// 闸门拒绝、词表拒绝或落库失败都不产生「半入库」状态。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkCloudPackJson } from "@/kernel/__tests__/fixtures/cloud-domain-pack";
import { upsertDomainPackAsset, type KnowledgeAreaVocabSeam } from "@/server/domain-pack-asset-service";

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

// ══════════════ 知识点清单引用形态写入路径（#83 / ADR 0010） ══════════════
// 词表接缝注入桩：entries 决定词表现状（id→名称/启停），currentRefIds 决定既有引用。

/** 夹具七类知识点的词表条目（默认全部启用、id 与名称一一对应） */
const vocabEntries = [
  { id: "ka-1", name: "单表查询与投影", active: true },
  { id: "ka-2", name: "条件筛选与排序", active: true },
  { id: "ka-3", name: "聚合与分组", active: true },
  { id: "ka-4", name: "多表 JOIN", active: true },
  { id: "ka-5", name: "子查询", active: true },
  { id: "ka-6", name: "日期函数", active: true },
  { id: "ka-7", name: "综合应用", active: true },
];

function mkVocab(overrides: {
  entries?: typeof vocabEntries;
  currentRefIds?: string[] | null;
} = {}): KnowledgeAreaVocabSeam {
  return {
    fetchKnowledgeAreaEntries: async () => overrides.entries ?? vocabEntries,
    fetchCurrentRefIds: async () => overrides.currentRefIds ?? null,
  };
}

describe("写入路径 × 知识点清单引用形态", () => {
  const refIds = ["ka-1", "ka-2", "ka-3", "ka-4", "ka-5", "ka-6", "ka-7"];

  it("引用形态闸门 + 词表校验通过后落库（引用数组随资产完整入库）", async () => {
    const { client, upsertMock } = mkClient();
    const json = mkCloudPackJson({ knowledgeAreaRefIds: refIds });
    const result = await upsertDomainPackAsset(client, json, { vocab: mkVocab() });
    expect(result.ok).toBe(true);
    expect(upsertMock.mock.calls[0][0]).toEqual({ pack_id: "cloud-fixture-pack", asset: json });
  });

  it("自由字符串形态不触词表接缝（现状行为零变化）", async () => {
    const { client, upsertMock } = mkClient();
    const fetchKnowledgeAreaEntries = vi.fn();
    await upsertDomainPackAsset(client, mkCloudPackJson(), {
      vocab: { fetchKnowledgeAreaEntries, fetchCurrentRefIds: async () => null },
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(fetchKnowledgeAreaEntries).not.toHaveBeenCalled();
  });

  it("引用不存在于词表 → 词表拒绝，不落库", async () => {
    const { client, upsertMock } = mkClient();
    const result = await upsertDomainPackAsset(
      client,
      mkCloudPackJson({ knowledgeAreaRefIds: ["ka-1", "ka-x", ...refIds.slice(2)] }),
      { vocab: mkVocab() },
    );
    expect(result).toMatchObject({ ok: false, kind: "vocabulary" });
    expect(upsertMock).not.toHaveBeenCalled();
    if (!result.ok && result.kind === "vocabulary") expect(result.message).toContain("ka-x");
  });

  it("名称清单与词表条目名称不对齐（归一化校验）→ 词表拒绝，不落库", async () => {
    const { client, upsertMock } = mkClient();
    const result = await upsertDomainPackAsset(client, mkCloudPackJson({ knowledgeAreaRefIds: refIds }), {
      vocab: mkVocab({ entries: vocabEntries.map((e, i) => (i === 0 ? { ...e, name: "改名后的知识点" } : e)) }),
    });
    expect(result).toMatchObject({ ok: false, kind: "vocabulary" });
    expect(upsertMock).not.toHaveBeenCalled();
    if (!result.ok && result.kind === "vocabulary") expect(result.message).toContain("单表查询与投影");
  });

  it("新增引用指向停用条目 → 词表拒绝（停用条目不可被新圈选）；既有引用保留停用条目不受影响", async () => {
    const { client, upsertMock } = mkClient();
    // 场景一：全新包（无既有引用）圈选了停用条目 ka-6 → 拒绝
    const deactivated = vocabEntries.map((e) => (e.id === "ka-6" ? { ...e, active: false } : e));
    const rejected = await upsertDomainPackAsset(client, mkCloudPackJson({ knowledgeAreaRefIds: refIds }), {
      vocab: mkVocab({ entries: deactivated }),
    });
    expect(rejected).toMatchObject({ ok: false, kind: "vocabulary" });
    if (!rejected.ok && rejected.kind === "vocabulary") expect(rejected.message).toContain("日期函数");
    expect(upsertMock).not.toHaveBeenCalled();

    // 场景二：既有包已引用 ka-6（微调保持清单不变）→ 停用不阻断既有引用，照常落库
    const kept = await upsertDomainPackAsset(
      client,
      mkCloudPackJson({ knowledgeAreaRefIds: refIds }),
      { vocab: mkVocab({ entries: deactivated, currentRefIds: refIds }) },
    );
    expect(kept.ok).toBe(true);
  });
});
