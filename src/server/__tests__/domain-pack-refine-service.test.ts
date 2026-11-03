// 接缝：域包微调与版本化编排服务（票 #62 / ADR-0009）——LLM provider 注入 fake、
// 鉴权注入桩、读写客户端注入桩。验证编排行为：
// - 微调草稿：提示词承载当前资产全文 + 修改意图；闸门报告透传；服务端 diff 判定 A/B 类；
// - 确认生效 A 类：packId 不变、不写版本历史；
// - 确认生效 B 类：packId 带递增版本后缀、旧版本写入 domain_pack_version_history、当前行更新；
// - packId 基础名不可改（ADR-0009）；目标域包不存在 404；鉴权 401/403。
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminDeps } from "@/server/admin-service";
import type { LlmProvider, LlmJsonPrompt } from "@/server/llm-provider";
import { mkCloudPackJson } from "@/kernel/__tests__/fixtures/cloud-domain-pack";
import type { DomainPackAsset } from "@/kernel/domain-pack-contract";
import {
  refineDomainPackDraft,
  applyDomainPackRefinement,
  getDomainPackVersionHistory,
  getDomainPackVersionContent,
  type RefineServiceDeps,
} from "@/server/domain-pack-refine-service";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";

/** 鉴权桩：默认教师（访问后台 + 域包管理） */
function mkAdminDeps(permissions: string[] = ["访问后台", "域包管理"]): AdminDeps {
  return {
    verifyAccessToken: vi.fn(async (token: string) => (token === "teacher-token" ? { userId: "u1" } : null)),
    fetchUserPermissions: vi.fn(async () => permissions),
  } as unknown as AdminDeps;
}

/** fake LLM provider：回放预设文本并记录提示词 */
function mkProvider(reply: () => string) {
  const calls: LlmJsonPrompt[] = [];
  const completeJson = vi.fn(async (prompt: LlmJsonPrompt) => {
    calls.push(prompt);
    return reply();
  });
  const provider: LlmProvider = { model: "fake-model", completeJson };
  return { provider, calls };
}

/** 云端行集（当前 + 历史）与读写客户端桩 */
function mkTables(currentRows: { pack_id: string; asset: unknown }[], historyRows: { pack_id: string; version_label: string; asset: unknown }[] = []) {
  const upserts: { table: string; rows: unknown }[] = [];
  return {
    upserts,
    deps: {
      readClient: {
        from: (table: string) => ({
          select: vi.fn(async () =>
            table === "domain_pack_asset"
              ? { data: currentRows, error: null }
              : { data: historyRows, error: null },
          ),
        }),
      },
      writeClient: {
        from: (table: string) => ({
          upsert: vi.fn(async (rows: unknown) => {
            upserts.push({ table, rows });
            return { error: null };
          }),
        }),
      },
    } satisfies Pick<RefineServiceDeps, "readClient" | "writeClient">,
  };
}

const auth = "Bearer teacher-token";
const PACK_ID = "library-loan";

beforeEach(() => vi.clearAllMocks());

describe("refineDomainPackDraft：微调草稿编排", () => {
  it("提示词承载当前资产全文与修改意图，草稿过闸门并附服务端 A/B 分类", async () => {
    const current = mkCloudPackJson({ packId: PACK_ID }) as unknown as DomainPackAsset;
    // A 类草稿：仅改难度档位描述
    const draft = {
      ...current,
      difficultyTiers: current.difficultyTiers.map((t) => ({ ...t, description: `${t.description}（修订）` })),
    };
    const { provider, calls } = mkProvider(() => JSON.stringify(draft));
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const result = await refineDomainPackDraft(
      { packId: PACK_ID, intent: "把难度档位描述改得更通俗" },
      auth,
      { provider, adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.report.passed).toBe(true);
    expect(result.changeClass).toBe("A");
    expect(result.currentVersionLabel).toBe("v1");
    expect(result.nextVersionLabel).toBe("v1"); // A 类不产生新版本
    expect(calls[0].user).toContain("把难度档位描述改得更通俗");
    expect(calls[0].user).toContain(PACK_ID);
    expect(calls[0].user).toContain("schemaSkeleton");
  });

  it("B 类草稿（模板变）：分类 B，预告知将产生的版本号", async () => {
    const current = mkCloudPackJson({ packId: PACK_ID }) as unknown as DomainPackAsset;
    const draft = {
      ...current,
      templates: current.templates.map((t, i) => (i === 0 ? { ...t, prompt: `${t.prompt}（微调）` } : t)),
    };
    const { provider } = mkProvider(() => JSON.stringify(draft));
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const result = await refineDomainPackDraft(
      { packId: PACK_ID, intent: "把第一题题面改清楚" },
      auth,
      { provider, adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.changeClass).toBe("B");
    expect(result.nextVersionLabel).toBe("v2");
  });

  it("目标域包不存在（云端无行且非内置基础名）：not_found", async () => {
    const { provider } = mkProvider(() => "{}");
    const tables = mkTables([]);
    const result = await refineDomainPackDraft(
      { packId: "ghost-pack", intent: "改" },
      auth,
      { provider, adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result).toEqual({ status: "not_found" });
    expect(provider.completeJson).not.toHaveBeenCalled();
  });

  it("内置基础包：当前资产取内置 JSON（云端行仅作演练配置覆盖底本的同源快照）", async () => {
    const draft = { ...mkCloudPackJson({ packId: "student-course-grade" }) };
    const { provider } = mkProvider(() => JSON.stringify(draft));
    const tables = mkTables([]); // 云端无行也能微调内置包
    const result = await refineDomainPackDraft(
      { packId: "student-course-grade", intent: "微调内置包" },
      auth,
      { provider, adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("ok");
  });

  it("无权限（缺域包管理）：forbidden", async () => {
    const { provider } = mkProvider(() => "{}");
    const tables = mkTables([{ pack_id: PACK_ID, asset: mkCloudPackJson({ packId: PACK_ID }) }]);
    const result = await refineDomainPackDraft(
      { packId: PACK_ID, intent: "改" },
      auth,
      { provider, adminDeps: mkAdminDeps(["访问后台"]), ...tables.deps },
    );
    expect(result).toEqual({ status: "forbidden" });
  });

  it("请求体缺意图：invalid", async () => {
    const { provider } = mkProvider(() => "{}");
    const result = await refineDomainPackDraft({ packId: PACK_ID }, auth, {
      provider,
      adminDeps: mkAdminDeps(),
      ...mkTables([]).deps,
    });
    expect(result).toEqual({ status: "invalid" });
  });

  // —— 票 #85：元素微调（单道题目模板定位；执行机制仍是全量重发，非补丁协议）——

  it("元素微调：提示词承载目标题目标识与逐字保留约束，闸门与分类链路不变（B 类）", async () => {
    const current = mkCloudPackJson({ packId: PACK_ID }) as unknown as DomainPackAsset;
    // 元素微调草稿：只改 cloud-tpl-01 的题面（B 类——参与种子生成的内容变）
    const draft = {
      ...current,
      templates: current.templates.map((t, i) => (i === 0 ? { ...t, prompt: `${t.prompt}（元素微调）` } : t)),
    };
    const { provider, calls } = mkProvider(() => JSON.stringify(draft));
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const result = await refineDomainPackDraft(
      { packId: PACK_ID, intent: "把这道题的提示写得更具体", targetTemplateId: "cloud-tpl-01" },
      auth,
      { provider, adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    // 「提示词承载」断言口径扩展为承载元素定位：目标题目标识 + 逐字保留约束点名到元素
    expect(calls[0].user).toContain("targetTemplateId=cloud-tpl-01");
    expect(calls[0].user).toContain("只修改");
    expect(calls[0].user).toContain("逐字保留");
    // 分类与版本预告走既有链路：改题目模板属 B 类 → 预告知 v2
    expect(result.changeClass).toBe("B");
    expect(result.nextVersionLabel).toBe("v2");
  });

  it("元素微调目标题目不在当前资产中：invalid，不发起 LLM 调用", async () => {
    const { provider } = mkProvider(() => "{}");
    const tables = mkTables([{ pack_id: PACK_ID, asset: mkCloudPackJson({ packId: PACK_ID }) }]);
    const result = await refineDomainPackDraft(
      { packId: PACK_ID, intent: "改一道不存在的题", targetTemplateId: "ghost-template" },
      auth,
      { provider, adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result).toEqual({ status: "invalid" });
    expect(provider.completeJson).not.toHaveBeenCalled();
  });

  it("targetTemplateId 类型不合法（非字符串）：invalid", async () => {
    const { provider } = mkProvider(() => "{}");
    const result = await refineDomainPackDraft(
      { packId: PACK_ID, intent: "改", targetTemplateId: 42 },
      auth,
      { provider, adminDeps: mkAdminDeps(), ...mkTables([{ pack_id: PACK_ID, asset: mkCloudPackJson({ packId: PACK_ID }) }]).deps },
    );
    expect(result).toEqual({ status: "invalid" });
  });
});

describe("applyDomainPackRefinement：确认生效", () => {
  it("A 类：packId 不变、更新当前行、不写版本历史（即时生效，ADR-0009）", async () => {
    const current = mkCloudPackJson({ packId: PACK_ID }) as unknown as DomainPackAsset;
    const draft = {
      ...current,
      practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } },
    };
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const result = await applyDomainPackRefinement(
      { packId: PACK_ID, pack: draft },
      auth,
      { adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.packId).toBe(PACK_ID);
    expect(result.changeClass).toBe("A");
    // 只更新当前表，不写历史
    expect(tables.upserts.map((u) => u.table)).toEqual(["domain_pack_asset"]);
    const row = tables.upserts[0].rows as { pack_id: string; asset: { packId: string } };
    expect(row.pack_id).toBe(PACK_ID);
    expect(row.asset.packId).toBe(PACK_ID);
  });

  it("B 类：产生新版本——旧资产写入版本历史，当前行更新为带 @v2 后缀的新资产", async () => {
    const current = mkCloudPackJson({ packId: PACK_ID }) as unknown as DomainPackAsset;
    const draft = {
      ...current,
      templates: current.templates.map((t, i) => (i === 0 ? { ...t, prompt: `${t.prompt}（微调）` } : t)),
    };
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const result = await applyDomainPackRefinement(
      { packId: PACK_ID, pack: draft },
      auth,
      { adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.packId).toBe(`${PACK_ID}@v2`);
    expect(result.changeClass).toBe("B");
    expect(result.versionLabel).toBe("v2");
    expect(parsePackIdVersion(result.packId).base).toBe(PACK_ID);
    // 先写历史（旧版本 v1 的完整资产），再更新当前行
    expect(tables.upserts.map((u) => u.table)).toEqual(["domain_pack_version_history", "domain_pack_asset"]);
    const historyRow = tables.upserts[0].rows as { pack_id: string; version_label: string; asset: { packId: string } };
    expect(historyRow.pack_id).toBe(PACK_ID); // v1 的完整 id 即基础名（无后缀约定）
    expect(historyRow.version_label).toBe("v1");
    expect(historyRow.asset.packId).toBe(PACK_ID);
    const currentRow = tables.upserts[1].rows as { pack_id: string; asset: { packId: string } };
    expect(currentRow.pack_id).toBe(PACK_ID); // 当前表 pack_id 恒为基础名（一行一域包）
    expect(currentRow.asset.packId).toBe(`${PACK_ID}@v2`);
  });

  it("B 类连续微调：版本号递增（v2 → v3），v2 写入历史", async () => {
    const v2 = mkCloudPackJson({ packId: `${PACK_ID}@v2` }) as unknown as DomainPackAsset;
    const draft = {
      ...v2,
      templates: v2.templates.map((t, i) => (i === 1 ? { ...t, prompt: `${t.prompt}（微调）` } : t)),
    };
    const tables = mkTables([{ pack_id: PACK_ID, asset: v2 }]);
    const result = await applyDomainPackRefinement(
      { packId: `${PACK_ID}@v2`, pack: draft },
      auth,
      { adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.packId).toBe(`${PACK_ID}@v3`);
    const historyRow = tables.upserts[0].rows as { pack_id: string; version_label: string };
    expect(historyRow.pack_id).toBe(`${PACK_ID}@v2`);
    expect(historyRow.version_label).toBe("v2");
  });

  it("草稿改了 packId 基础名：拒绝（ADR-0009 基础名永不改）", async () => {
    const current = mkCloudPackJson({ packId: PACK_ID }) as unknown as DomainPackAsset;
    const draft = { ...current, packId: "renamed-pack" };
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const result = await applyDomainPackRefinement(
      { packId: PACK_ID, pack: draft },
      auth,
      { adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result).toEqual({ status: "base_name_changed", actualBasePackId: "renamed-pack" });
    expect(tables.upserts).toEqual([]);
  });

  it("闸门拒绝草稿：不落库，报告透传（与发布同一闸门）", async () => {
    const current = mkCloudPackJson({ packId: PACK_ID }) as unknown as DomainPackAsset;
    const draft = { ...current, templates: current.templates.slice(0, 3) }; // 模板数不足，闸门拒
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const result = await applyDomainPackRefinement(
      { packId: PACK_ID, pack: draft },
      auth,
      { adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("gate");
    expect(tables.upserts).toEqual([]);
  });

  it("无变化草稿（unchanged）：invalid——确认生效必须承载实际修改", async () => {
    const current = mkCloudPackJson({ packId: PACK_ID }) as unknown as DomainPackAsset;
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const result = await applyDomainPackRefinement(
      { packId: PACK_ID, pack: current },
      auth,
      { adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result).toEqual({ status: "no_change" });
  });

  it("内置基础包 B 类微调：当前行写带后缀新资产（内置 JSON 本身永不改，#58 防漂移不破）", async () => {
    // 内置包当前资产 = 内置 JSON（云端无行）；草稿 B 类改模板
    const { builtinPackAssets } = await import("@/domain-packs/builtin-packs");
    const current: DomainPackAsset = builtinPackAssets[0];
    const draft = {
      ...current,
      templates: current.templates.map((t, i) => (i === 0 ? { ...t, prompt: `${t.prompt}（微调）` } : t)),
    };
    const tables = mkTables([]);
    const result = await applyDomainPackRefinement(
      { packId: current.packId, pack: draft },
      auth,
      { adminDeps: mkAdminDeps(), ...tables.deps },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.packId).toBe(`${current.packId}@v2`);
    const historyRow = tables.upserts[0].rows as { pack_id: string; version_label: string; asset: { packId: string } };
    expect(historyRow.version_label).toBe("v1");
    expect(historyRow.asset.packId).toBe(current.packId);
  });

  it("引用形态草稿词表校验不通过（引用已被删除）：vocabulary 拒绝，不落库（#83）", async () => {
    const current = {
      ...mkCloudPackJson({ packId: PACK_ID }),
      knowledgeAreaRefIds: ["ka-1", "ka-2", "ka-3", "ka-4", "ka-5", "ka-6", "ka-7"],
    } as unknown as DomainPackAsset;
    // LLM 回显引用数组但 ka-7 已被从词表删除：草稿 B 类（模板微调）
    const draft = {
      ...current,
      templates: current.templates.map((t, i) => (i === 0 ? { ...t, prompt: `${t.prompt}（微调）` } : t)),
    };
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const vocab = {
      fetchKnowledgeAreaEntries: async () =>
        ["ka-1", "ka-2", "ka-3", "ka-4", "ka-5", "ka-6"].map((id, i) => ({
          id,
          name: (current.knowledgeAreas as string[])[i],
          active: true,
        })),
      fetchCurrentRefIds: async () => current.knowledgeAreaRefIds ?? null,
    };
    const result = await applyDomainPackRefinement(
      { packId: PACK_ID, pack: draft },
      auth,
      { adminDeps: mkAdminDeps(), vocabSeam: vocab, ...tables.deps },
    );
    expect(result).toMatchObject({ status: "vocabulary" });
    expect(tables.upserts).toEqual([]);
  });

  it("引用形态草稿词表校验通过（既有引用含已停用条目）：照常落库，停用不阻断既有引用（#83）", async () => {
    const refIds = ["ka-1", "ka-2", "ka-3", "ka-4", "ka-5", "ka-6", "ka-7"];
    const current = {
      ...mkCloudPackJson({ packId: PACK_ID }),
      knowledgeAreaRefIds: refIds,
    } as unknown as DomainPackAsset;
    const draft = {
      ...current,
      templates: current.templates.map((t, i) => (i === 0 ? { ...t, prompt: `${t.prompt}（微调）` } : t)),
    };
    const tables = mkTables([{ pack_id: PACK_ID, asset: current }]);
    const names = current.knowledgeAreas as string[];
    const vocab = {
      fetchKnowledgeAreaEntries: async () =>
        refIds.map((id, i) => ({ id, name: names[i], active: id !== "ka-6" })), // ka-6 已停用但属既有引用
      fetchCurrentRefIds: async () => refIds,
    };
    const result = await applyDomainPackRefinement(
      { packId: PACK_ID, pack: draft },
      auth,
      { adminDeps: mkAdminDeps(), vocabSeam: vocab, ...tables.deps },
    );
    expect(result.status).toBe("ok");
    expect(tables.upserts.length).toBeGreaterThan(0);
  });
});

describe("getDomainPackVersionHistory：版本历史查询", () => {
  it("历史行按版本倒序，含当前版本（isCurrent 标记）", async () => {
    const v1 = mkCloudPackJson({ packId: PACK_ID });
    const v2 = mkCloudPackJson({ packId: `${PACK_ID}@v2` }) as unknown as DomainPackAsset;
    const tables = mkTables(
      [{ pack_id: PACK_ID, asset: v2 }],
      [
        { pack_id: PACK_ID, version_label: "v1", asset: v1 },
        { pack_id: `${PACK_ID}@v2`, version_label: "v2", asset: v2 },
      ],
    );
    const result = await getDomainPackVersionHistory(PACK_ID, auth, {
      adminDeps: mkAdminDeps(),
      ...tables.deps,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.versions.map((v) => `${v.versionLabel}:${v.isCurrent}`)).toEqual(["v2:true", "v1:false"]);
    expect(result.versions[1].packId).toBe(PACK_ID);
  });
});

// —— 票 #86：历史版本完整内容查询（版本内容视图页数据源）——

describe("getDomainPackVersionContent：版本完整内容查询", () => {
  it("请求当前版本 packId：返回当前资产并带 isCurrent 标记", async () => {
    const v2 = mkCloudPackJson({ packId: `${PACK_ID}@v2` }) as unknown as DomainPackAsset;
    const tables = mkTables([{ pack_id: PACK_ID, asset: v2 }]);
    const result = await getDomainPackVersionContent(`${PACK_ID}@v2`, auth, {
      adminDeps: mkAdminDeps(),
      ...tables.deps,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.isCurrent).toBe(true);
    expect(result.versionLabel).toBe("v2");
    expect(result.asset.packId).toBe(`${PACK_ID}@v2`);
    // 难度档位定义随资产透传（留在资产态供教师端展示，ADR-0009）
    expect(result.asset.difficultyTiers).toHaveLength(5);
  });

  it("请求历史版本 packId：从版本历史表取旧资产（旧字符串清单形态兼容渲染）", async () => {
    const v1 = mkCloudPackJson({ packId: PACK_ID, name: "图书馆借阅" });
    const v2 = mkCloudPackJson({ packId: `${PACK_ID}@v2` }) as unknown as DomainPackAsset;
    const tables = mkTables(
      [{ pack_id: PACK_ID, asset: v2 }],
      [{ pack_id: PACK_ID, version_label: "v1", asset: v1 }],
    );
    const result = await getDomainPackVersionContent(PACK_ID, auth, {
      adminDeps: mkAdminDeps(),
      ...tables.deps,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.isCurrent).toBe(false);
    expect(result.versionLabel).toBe("v1");
    expect(result.asset.packId).toBe(PACK_ID);
    expect(result.asset.name).toBe("图书馆借阅");
    // 旧字符串清单形态：无 knowledgeAreaRefIds 字段，知识点清单仍完整可读
    expect(result.asset.knowledgeAreaRefIds).toBeUndefined();
    expect(result.asset.knowledgeAreas.length).toBeGreaterThan(0);
  });

  it("请求不存在的版本 packId：not_found", async () => {
    const v2 = mkCloudPackJson({ packId: `${PACK_ID}@v2` }) as unknown as DomainPackAsset;
    const tables = mkTables([{ pack_id: PACK_ID, asset: v2 }]);
    const result = await getDomainPackVersionContent(`${PACK_ID}@v9`, auth, {
      adminDeps: mkAdminDeps(),
      ...tables.deps,
    });
    expect(result.status).toBe("not_found");
  });

  it("无权限点：forbidden", async () => {
    const tables = mkTables([]);
    const result = await getDomainPackVersionContent(PACK_ID, auth, {
      adminDeps: mkAdminDeps([]),
      ...tables.deps,
    });
    expect(result.status).toBe("forbidden");
  });
});
