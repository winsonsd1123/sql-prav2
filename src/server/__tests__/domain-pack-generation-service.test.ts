// 接缝：域包生成/发布编排服务（票 #59）——LLM provider 注入 fake、鉴权注入桩、
// 写入客户端注入桩，验证编排行為：鉴权（401/403）、提示词组装、LLM 失败分类、
// 草稿必过闸门且报告透传、发布走 #57 upsertDomainPackAsset（服务端重过闸门）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminDeps } from "@/server/admin-service";
import type { LlmProvider, LlmJsonPrompt } from "@/server/llm-provider";
import { LlmProviderError } from "@/server/llm-provider";
import { mkCloudPackJson, CLOUD_FIXTURE_KNOWLEDGE_AREAS } from "@/kernel/__tests__/fixtures/cloud-domain-pack";
import { generateDomainPackDraft, publishDomainPack, type GenerationServiceDeps } from "@/server/domain-pack-generation-service";
import { parseDomainPackJson, assetToKernelPack } from "@/kernel/domain-pack-contract";
import { generatePracticeSession } from "@/kernel/question-picking";

/** 鉴权桩：默认教师（持「访问后台」+「域包管理」两个权限点），可控切换 */
function mkAdminDeps(permissions: string[] = ["访问后台", "域包管理"]): AdminDeps {
  return {
    verifyAccessToken: vi.fn(async (token: string) => (token === "teacher-token" ? { userId: "u1" } : null)),
    fetchUserPermissions: vi.fn(async () => permissions),
  } as unknown as AdminDeps;
}

/** fake LLM provider：回放预设文本；记录收到的提示词供断言 */
function mkProvider(reply: () => string) {
  const calls: LlmJsonPrompt[] = [];
  const provider: LlmProvider = {
    model: "fake-model",
    async completeJson(prompt) {
      calls.push(prompt);
      return reply();
    },
  };
  return { provider, calls };
}

function mkDeps(overrides: Partial<GenerationServiceDeps> = {}): GenerationServiceDeps {
  const upsertMock = vi.fn().mockResolvedValue({ error: null });
  return {
    provider: mkProvider(() => JSON.stringify(mkCloudPackJson({ packId: "llm-draft-pack" }))).provider,
    adminDeps: mkAdminDeps(),
    writeClient: { from: () => ({ upsert: upsertMock }) },
    ...overrides,
  };
}

const auth = "Bearer teacher-token";
const input = { description: "图书馆借阅场景：读者、图书、借阅记录" };

beforeEach(() => vi.clearAllMocks());

describe("generateDomainPackDraft：生成编排", () => {
  it("生成成功：提示词承载教师输入，返回草稿与完整闸门报告（passed=true）", async () => {
    const { provider, calls } = mkProvider(() => JSON.stringify(mkCloudPackJson({ packId: "llm-draft-pack" })));
    const result = await generateDomainPackDraft(input, auth, mkDeps({ provider }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.draft).toMatchObject({ packId: "llm-draft-pack" });
    expect(result.report.passed).toBe(true);
    expect(result.report.structural.status).toBe("通过");
    expect(calls[0].user).toContain("图书馆借阅场景");
    expect(calls[0].system).toContain("schemaSkeleton");
  });

  it("LLM 返回非法 JSON：返回明确错误分类（llm_invalid_json），不静默降级", async () => {
    const { provider } = mkProvider(() => "这不是 JSON{{{");
    const result = await generateDomainPackDraft(input, auth, mkDeps({ provider }));
    expect(result.status).toBe("llm_invalid_json");
  });

  it("LLM 网络失败：返回明确错误分类（llm_error）与可重试信息", async () => {
    const provider: LlmProvider = {
      model: "fake",
      completeJson: () => Promise.reject(new LlmProviderError("LLM 网络请求失败：fetch failed", "network")),
    };
    const result = await generateDomainPackDraft(input, auth, mkDeps({ provider }));
    expect(result.status).toBe("llm_error");
    if (result.status === "llm_error") {
      expect(result.kind).toBe("network");
      expect(result.message).toContain("可重试");
    }
  });

  it("闸门拒绝的草稿：草稿与闸门报告都返回（passed=false，供教师端渲染问题清单）", async () => {
    // 合法夹具抽掉模板 → 结构检查失败（模板数不足）
    const broken = mkCloudPackJson();
    broken.templates = (broken.templates as unknown[]).slice(0, 10);
    const { provider } = mkProvider(() => JSON.stringify(broken));
    const result = await generateDomainPackDraft(input, auth, mkDeps({ provider }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.report.passed).toBe(false);
    expect(result.report.structural.status).toBe("失败");
    expect(result.draft).toBeDefined();
  });

  it("无 token：401；持「访问后台」但无「域包管理」：403", async () => {
    const unauthorized = await generateDomainPackDraft(input, null, mkDeps());
    expect(unauthorized.status).toBe("unauthorized");
    const forbidden = await generateDomainPackDraft(input, auth, mkDeps({ adminDeps: mkAdminDeps(["访问后台"]) }));
    expect(forbidden.status).toBe("forbidden");
  });

  it("描述为空或非字符串：invalid，不触发 LLM 调用", async () => {
    const { provider } = mkProvider(() => JSON.stringify(mkCloudPackJson()));
    const spy = vi.spyOn(provider, "completeJson");
    const empty = await generateDomainPackDraft({ description: "  " }, auth, mkDeps({ provider }));
    expect(empty.status).toBe("invalid");
    const missing = await generateDomainPackDraft({} as { description: string }, auth, mkDeps({ provider }));
    expect(missing.status).toBe("invalid");
    expect(spy).not.toHaveBeenCalled();
  });

  // ── 圈选生成（票 #82 / spec #75，ADR 0010「圈选即封闭」双重强制）──
  // 词表桩：夹具七知识点逐条建条目（id ka-1..ka-7，全启用），供圈选解析与提示词注入断言。
  const vocabEntries = [...CLOUD_FIXTURE_KNOWLEDGE_AREAS].map((name, i) => ({
    id: `ka-${i + 1}`,
    name,
    description: `「${name}」的考察要点说明`,
    active: true,
  }));
  const mkVocabStub = (entries = vocabEntries) => ({
    fetchKnowledgeAreaEntries: vi.fn(async () => entries),
  });

  it("未圈选：提示词与现状零差异（不含圈选栏目），草稿不加盖词表引用", async () => {
    const { provider, calls } = mkProvider(() => JSON.stringify(mkCloudPackJson({ packId: "free-draft-pack" })));
    const result = await generateDomainPackDraft(input, auth, mkDeps({ provider, generationVocabSeam: mkVocabStub() }));
    expect(result.status).toBe("ok");
    expect(calls[0].user).toContain("图书馆借阅场景");
    expect(calls[0].user).not.toContain("圈选");
    if (result.status !== "ok") throw new Error("unreachable");
    expect((result.draft as { knowledgeAreaRefIds?: unknown }).knowledgeAreaRefIds).toBeUndefined();
  });

  it("圈选生成：提示词注入圈选集合（名称+描述），封闭通过时草稿加盖 knowledgeAreaRefIds（与清单逐位对齐）", async () => {
    const { provider, calls } = mkProvider(() => JSON.stringify(mkCloudPackJson({ packId: "selected-draft-pack" })));
    const selectedIds = vocabEntries.map((e) => e.id);
    const result = await generateDomainPackDraft(
      { ...input, knowledgeAreaIds: selectedIds },
      auth,
      mkDeps({ provider, generationVocabSeam: mkVocabStub() }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    // 提示词侧强制：集合条目（名称与描述）进入用户提示词
    expect(calls[0].user).toContain("圈选");
    expect(calls[0].user).toContain("「多表 JOIN」的考察要点说明");
    // 闸门按圈选集合校验，全在集合内 → 通过；草稿盖章为词表引用形态（发布走 #83 校验）
    expect(result.report.passed).toBe(true);
    expect((result.draft as { knowledgeAreaRefIds?: string[] }).knowledgeAreaRefIds).toEqual(selectedIds);
  });

  it("fake LLM 产出越界清单：闸门封闭校验拒绝（结构检查报告圈选越界），草稿与报告照常返回", async () => {
    // 圈选集合剔除「子查询」，fake LLM 仍回夹具全七项 → 越界
    const selectedIds = vocabEntries.filter((e) => e.name !== "子查询").map((e) => e.id);
    const { provider } = mkProvider(() => JSON.stringify(mkCloudPackJson({ packId: "out-of-closure-pack" })));
    const result = await generateDomainPackDraft(
      { ...input, knowledgeAreaIds: selectedIds },
      auth,
      mkDeps({ provider, generationVocabSeam: mkVocabStub() }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.report.passed).toBe(false);
    expect(result.report.structural.status).toBe("失败");
    expect(result.report.structural.issues.some((i) => i.message.includes("子查询") && i.message.includes("圈选"))).toBe(true);
    // 越界草稿不加盖词表引用（未过封闭校验，不得以引用形态流转）
    expect((result.draft as { knowledgeAreaRefIds?: unknown }).knowledgeAreaRefIds).toBeUndefined();
  });

  it("圈选生成→发布闭环：加盖引用的草稿经 #83 词表语义校验落库（引用形态写入路径）", async () => {
    const { provider } = mkProvider(() => JSON.stringify(mkCloudPackJson({ packId: "closed-loop-pack" })));
    const selectedIds = vocabEntries.map((e) => e.id);
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const deps = mkDeps({
      provider,
      generationVocabSeam: mkVocabStub(),
      writeClient: { from: () => ({ upsert: upsertMock }) },
      vocabSeam: {
        fetchKnowledgeAreaEntries: async () => vocabEntries.map(({ id, name, active }) => ({ id, name, active })),
        fetchCurrentRefIds: async () => null,
      },
    });
    const draftResult = await generateDomainPackDraft({ ...input, knowledgeAreaIds: selectedIds }, auth, deps);
    if (draftResult.status !== "ok") throw new Error("unreachable");
    expect(draftResult.report.passed).toBe(true);
    const publishResult = await publishDomainPack({ pack: draftResult.draft }, auth, deps);
    expect(publishResult.status).toBe("ok");
    if (publishResult.status !== "ok") throw new Error("unreachable");
    expect(publishResult.packId).toBe("closed-loop-pack");
    // 落库行保持引用形态（#83：asset 携带 knowledgeAreaRefIds）
    const row = upsertMock.mock.calls[0][0] as { pack_id: string; asset: { knowledgeAreaRefIds?: string[] } };
    expect(row.asset.knowledgeAreaRefIds).toEqual(selectedIds);
  });

  it("圈选 id 不在词表或指向停用条目：invalid 并透出中文原因，不触发 LLM 调用", async () => {
    const { provider } = mkProvider(() => JSON.stringify(mkCloudPackJson()));
    const spy = vi.spyOn(provider, "completeJson");
    const unknown = await generateDomainPackDraft(
      { ...input, knowledgeAreaIds: ["ka-1", "no-such-id"] },
      auth,
      mkDeps({ provider, generationVocabSeam: mkVocabStub() }),
    );
    expect(unknown.status).toBe("invalid");
    if (unknown.status === "invalid") expect(unknown.message).toContain("no-such-id");
    const entriesWithInactive = vocabEntries.map((e) => (e.name === "子查询" ? { ...e, active: false } : e));
    const inactive = await generateDomainPackDraft(
      { ...input, knowledgeAreaIds: ["ka-1", "ka-5"] },
      auth,
      mkDeps({ provider, generationVocabSeam: mkVocabStub(entriesWithInactive) }),
    );
    expect(inactive.status).toBe("invalid");
    if (inactive.status === "invalid") expect(inactive.message).toContain("子查询");
    expect(spy).not.toHaveBeenCalled();
  });

  it("圈选 id 数组为空或缺省：视同未圈选，走现状路径", async () => {
    const { provider, calls } = mkProvider(() => JSON.stringify(mkCloudPackJson({ packId: "empty-selection-pack" })));
    const empty = await generateDomainPackDraft({ ...input, knowledgeAreaIds: [] }, auth, mkDeps({ provider, generationVocabSeam: mkVocabStub() }));
    expect(empty.status).toBe("ok");
    expect(calls[0].user).not.toContain("圈选");
    if (empty.status !== "ok") throw new Error("unreachable");
    expect((empty.draft as { knowledgeAreaRefIds?: unknown }).knowledgeAreaRefIds).toBeUndefined();
  });
});

describe("publishDomainPack：确认发布编排", () => {
  it("发布成功：草稿重过闸门后经 #57 写入路径落库（首次发布即版本 1）", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn(() => ({ upsert: upsertMock }));
    const deps = mkDeps({ writeClient: { from: fromMock } });
    const pack = mkCloudPackJson({ packId: "publish-test-pack" });
    const result = await publishDomainPack({ pack }, auth, deps);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.packId).toBe("publish-test-pack");
    expect(fromMock).toHaveBeenCalledWith("domain_pack_asset");
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ pack_id: "publish-test-pack" });
  });

  it("发布后域包可被加载层收录：写入的 asset 过契约并可开练（发布→学生端出现）", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const deps = mkDeps({ writeClient: { from: () => ({ upsert: upsertMock }) } });
    const pack = mkCloudPackJson({ packId: "publish-load-pack" });
    await publishDomainPack({ pack }, auth, deps);
    const row = upsertMock.mock.calls[0][0] as { pack_id: string; asset: unknown };
    expect(row.pack_id).toBe("publish-load-pack");
    // 复现 #57 加载层收录检查口径（cloud-domain-pack-store.toLoadablePack）：契约快校验 + 可开练
    const parsed = parseDomainPackJson(row.asset);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(generatePracticeSession(42, assetToKernelPack(parsed.pack)).questions).toHaveLength(10);
    }
  });

  it("前端被篡改的草稿：服务端重过闸门拒绝，返回闸门报告且不落库", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const deps = mkDeps({ writeClient: { from: () => ({ upsert: upsertMock }) } });
    const pack = mkCloudPackJson();
    pack.templates = (pack.templates as unknown[]).slice(0, 5);
    const result = await publishDomainPack({ pack }, auth, deps);
    expect(result.status).toBe("gate");
    if (result.status === "gate") expect(result.report.passed).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("落库失败：透出 storage 错误信息", async () => {
    const deps = mkDeps({ writeClient: { from: () => ({ upsert: vi.fn().mockResolvedValue({ error: { message: "连接失败" } }) }) } }) as GenerationServiceDeps;
    const result = await publishDomainPack({ pack: mkCloudPackJson() }, auth, deps);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toContain("连接失败");
  });

  it("无 token：401；无「域包管理」权限：403；载荷缺 pack：invalid", async () => {
    expect((await publishDomainPack({ pack: mkCloudPackJson() }, null, mkDeps())).status).toBe("unauthorized");
    expect((await publishDomainPack({ pack: mkCloudPackJson() }, auth, mkDeps({ adminDeps: mkAdminDeps(["访问后台"]) }))).status).toBe("forbidden");
    expect((await publishDomainPack({}, auth, mkDeps())).status).toBe("invalid");
  });

  it("引用形态草稿圈选了停用条目（#83）：vocabulary 拒绝并透出中文原因，不落库", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const names = [...CLOUD_FIXTURE_KNOWLEDGE_AREAS];
    const refIds = names.map((_n, i) => `ka-${i + 1}`);
    const pack = mkCloudPackJson({ knowledgeAreaRefIds: refIds });
    const deps = mkDeps({
      writeClient: { from: () => ({ upsert: upsertMock }) },
      vocabSeam: {
        fetchKnowledgeAreaEntries: async () =>
          refIds.map((id, i) => ({ id, name: names[i], active: id !== "ka-6" })), // 「日期函数」已停用
        fetchCurrentRefIds: async () => null,
      },
    });
    const result = await publishDomainPack({ pack }, auth, deps);
    expect(result.status).toBe("vocabulary");
    if (result.status === "vocabulary") expect(result.message).toContain("日期函数");
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
