// 接缝：演练配置编辑服务（票 #61 / spec #53 目标②）——鉴权（401/403）、
// 视图列出（内置为底、云端行覆盖当前配置）、保存（服务端重校验：总和一致、
// 档位合法、配额不超该档模板数；过闸门后落库，A 类改动 packId 不变不产生版本行）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminDeps } from "@/server/admin-service";
import { mkCloudPackJson } from "@/kernel/__tests__/fixtures/cloud-domain-pack";
import {
  getPracticeConfigView,
  savePracticeConfig,
  type PracticeConfigServiceDeps,
} from "@/server/practice-config-service";

/** 鉴权桩：默认教师（持「访问后台」+「域包管理」），可控切换 */
function mkAdminDeps(permissions: string[] = ["访问后台", "域包管理"]): AdminDeps {
  return {
    verifyAccessToken: vi.fn(async (token: string) => (token === "teacher-token" ? { userId: "u1" } : null)),
    fetchUserPermissions: vi.fn(async () => permissions),
  } as unknown as AdminDeps;
}

/** 云端读桩：回放预设行集 */
function mkReadClient(rows: { pack_id: string; asset: unknown }[]) {
  return {
    from: () => ({
      select: vi.fn(async () => ({ data: rows, error: null })),
    }),
  };
}

function mkDeps(overrides: Partial<PracticeConfigServiceDeps> = {}): PracticeConfigServiceDeps {
  const upsertMock = vi.fn().mockResolvedValue({ error: null });
  return {
    adminDeps: mkAdminDeps(),
    readClient: mkReadClient([]),
    writeClient: { from: () => ({ upsert: upsertMock }) },
    ...overrides,
  };
}

const auth = "Bearer teacher-token";
const builtinPackId = "student-course-grade";

beforeEach(() => vi.clearAllMocks());

describe("getPracticeConfigView：配置视图", () => {
  it("无 token / 坏 token → unauthorized；无「域包管理」权限点 → forbidden", async () => {
    expect((await getPracticeConfigView(null, mkDeps())).status).toBe("unauthorized");
    expect((await getPracticeConfigView("Bearer bad", mkDeps())).status).toBe("unauthorized");
    const noPerm = mkDeps({ adminDeps: mkAdminDeps(["访问后台"]) });
    expect((await getPracticeConfigView(auth, noPerm)).status).toBe("forbidden");
  });

  it("内置两包为底（默认配置与各档模板数），云端同 id 行覆盖当前配置", async () => {
    const rows = [
      {
        pack_id: builtinPackId,
        asset: { ...mkCloudPackJson({ packId: builtinPackId }), practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } } },
      },
    ];
    const result = await getPracticeConfigView(auth, mkDeps({ readClient: mkReadClient(rows) }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.packs).toHaveLength(2);
    const overridden = result.packs.find((p) => p.packId === builtinPackId)!;
    expect(overridden.practiceConfig.totalQuestions).toBe(7);
    const other = result.packs.find((p) => p.packId === "employee-department-payroll")!;
    expect(other.practiceConfig.totalQuestions).toBe(10); // 未编辑的包保持内置默认
    // 各档模板数提示（内置包A：1×3 2×12 3×10 4×7 5×2）
    expect(overridden.tierTemplateCounts).toEqual({ "1": 3, "2": 12, "3": 10, "4": 7, "5": 2 });
  });

  it("云端读取失败降级为仅内置默认配置（管理页可用性优先，不因云端故障白屏）", async () => {
    const failing = { from: () => ({ select: vi.fn(async () => ({ data: null, error: { message: "boom" } })) }) };
    const result = await getPracticeConfigView(auth, mkDeps({ readClient: failing }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.packs).toHaveLength(2);
    expect(result.packs.every((p) => p.practiceConfig.totalQuestions === 10)).toBe(true);
  });
});

describe("savePracticeConfig：保存（A 类改动，服务端重校验）", () => {
  const valid = { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } };

  it("无 token → unauthorized；无权限点 → forbidden；载荷非对象 → invalid", async () => {
    expect((await savePracticeConfig({ packId: builtinPackId, practiceConfig: valid }, null, mkDeps())).status).toBe("unauthorized");
    const noPerm = mkDeps({ adminDeps: mkAdminDeps(["访问后台"]) });
    expect((await savePracticeConfig({ packId: builtinPackId, practiceConfig: valid }, auth, noPerm)).status).toBe("forbidden");
    expect((await savePracticeConfig("不是对象", auth, mkDeps())).status).toBe("invalid");
    expect((await savePracticeConfig({ practiceConfig: valid }, auth, mkDeps())).status).toBe("invalid");
  });

  it("不存在的域包 → not_found（只能编辑已发布的域包）", async () => {
    const result = await savePracticeConfig({ packId: "no-such-pack", practiceConfig: valid }, auth, mkDeps());
    expect(result.status).toBe("not_found");
  });

  it("非法配置被服务端拒绝（总和不一致 / 档位越界 / 配额超该档模板数），错误为契约中文信息", async () => {
    const sumMismatch = await savePracticeConfig(
      { packId: builtinPackId, practiceConfig: { totalQuestions: 8, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } } },
      auth,
      mkDeps(),
    );
    expect(sumMismatch.status).toBe("invalid");
    if (sumMismatch.status === "invalid") expect(sumMismatch.errors.join()).toContain("必须等于总题数");

    const badTier = await savePracticeConfig(
      { packId: builtinPackId, practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "6": 1 } } },
      auth,
      mkDeps(),
    );
    expect(badTier.status).toBe("invalid");

    // 内置包A 档 1 仅 3 个模板：配额 4 超限
    const overQuota = await savePracticeConfig(
      { packId: builtinPackId, practiceConfig: { totalQuestions: 11, tierDistribution: { "1": 4, "2": 3, "3": 2, "4": 1, "5": 1 } } },
      auth,
      mkDeps(),
    );
    expect(overQuota.status).toBe("invalid");
    if (overQuota.status === "invalid") expect(overQuota.errors.join()).toContain("超过该档模板数");
  });

  it("合法保存：以云端现行为底（无云端行则内置资产）替换 practiceConfig，过闸门整包落库、packId 不变", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const deps = mkDeps({ writeClient: { from: () => ({ upsert: upsertMock }) } });
    const result = await savePracticeConfig({ packId: builtinPackId, practiceConfig: valid }, auth, deps);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.packId).toBe(builtinPackId);
    expect(result.practiceConfig).toEqual(valid);
    // 落库整包资产：pack_id 不变（A 类改动不产生版本），practiceConfig 已替换、其余内容保持内置
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const row = upsertMock.mock.calls[0][0] as { pack_id: string; asset: { practiceConfig: unknown; templates: unknown[] } };
    expect(row.pack_id).toBe(builtinPackId);
    expect(row.asset.practiceConfig).toEqual(valid);
    expect(row.asset.templates.length).toBeGreaterThanOrEqual(25);
  });

  it("云端已有该包行（如教师发布过的包）：以云端行为底替换配置，不回退内置旧内容", async () => {
    const cloudAsset = mkCloudPackJson({ packId: "cloud-fixture-pack" });
    const rows = [{ pack_id: "cloud-fixture-pack", asset: cloudAsset }];
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const deps = mkDeps({
      readClient: mkReadClient(rows),
      writeClient: { from: () => ({ upsert: upsertMock }) },
    });
    const result = await savePracticeConfig(
      { packId: "cloud-fixture-pack", practiceConfig: { totalQuestions: 6, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 0 } } },
      auth,
      deps,
    );
    expect(result.status).toBe("ok");
    const row = upsertMock.mock.calls[0][0] as { asset: Record<string, unknown> };
    // 云端行的模板等其余字段原样保留，仅 practiceConfig 被替换
    expect(row.asset.templates).toEqual((cloudAsset as Record<string, unknown>).templates);
    expect((row.asset.practiceConfig as { totalQuestions: number }).totalQuestions).toBe(6);
  });

  it("非法云端行被剔除（契约不过的脏行不进视图/底稿）：回退内置资产为底照常保存", async () => {
    const broken = mkCloudPackJson();
    (broken as { templates: unknown[] }).templates = []; // 破坏模板数下界 → 契约不过
    const rows = [{ pack_id: builtinPackId, asset: broken }];
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const deps = mkDeps({ readClient: mkReadClient(rows), writeClient: { from: () => ({ upsert: upsertMock }) } });
    const result = await savePracticeConfig({ packId: builtinPackId, practiceConfig: valid }, auth, deps);
    expect(result.status).toBe("ok");
    const row = upsertMock.mock.calls[0][0] as { pack_id: string; asset: { templates: unknown[] } };
    // 底稿是内置包（25+ 模板），不是被破坏的云端脏行
    expect(row.asset.templates.length).toBeGreaterThanOrEqual(25);
  });

  it("落库失败 → error 透传消息", async () => {
    const deps = mkDeps({ writeClient: { from: () => ({ upsert: vi.fn().mockResolvedValue({ error: { message: "写库失败" } }) }) } });
    const result = await savePracticeConfig({ packId: builtinPackId, practiceConfig: valid }, auth, deps);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toBe("写库失败");
  });
});

// ── 内置包云端行底本纪律（票 #62 收口 #61 遗留）：内置基础包的云端行只承载内置资产的同源快照
//    + 演练配置覆盖；保存底稿恒取服务端内置 JSON，杜绝「前端发布新内置 JSON 后云端旧行漂移顶替」──

describe("savePracticeConfig × 内置包底本纪律（票 #62）", () => {
  it("内置包云端行内容与内置 JSON 漂移时：底稿仍取内置资产（云端行只允许覆盖配置，不允许顶替种子内容）", async () => {
    const { builtinPackAssets } = await import("@/domain-packs/builtin-packs");
    // 云端行：模板被篡改的旧快照（模拟历史保存写入的漂移行）
    const drifted = {
      ...builtinPackAssets[0],
      templates: builtinPackAssets[0].templates.slice(0, 25), // 数量漂移
      practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } },
    };
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const result = await savePracticeConfig(
      {
        packId: builtinPackId,
        practiceConfig: { totalQuestions: 8, tierDistribution: { "1": 2, "2": 2, "3": 2, "4": 1, "5": 1 } },
      },
      auth,
      {
        adminDeps: mkAdminDeps(),
        readClient: mkReadClient([{ pack_id: builtinPackId, asset: drifted }]),
        writeClient: { from: () => ({ upsert: upsertMock }) },
      },
    );
    expect(result.status).toBe("ok");
    const written = upsertMock.mock.calls[0][0] as { pack_id: string; asset: { templates: unknown[]; practiceConfig: { totalQuestions: number } } };
    // 落库资产 = 内置 JSON 底稿 + 新配置（模板数与内置一致，不随漂移行）
    expect(written.asset.templates).toHaveLength(builtinPackAssets[0].templates.length);
    expect(written.asset.practiceConfig.totalQuestions).toBe(8);
  });

  it("版本化的内置包（packId 带后缀，如 student-course-grade@v2）保存配置：底稿仍取云端当前行（非内置 JSON）", async () => {
    const v2 = mkCloudPackJson({ packId: "student-course-grade@v2" });
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const result = await savePracticeConfig(
      {
        packId: "student-course-grade@v2",
        practiceConfig: { totalQuestions: 8, tierDistribution: { "1": 2, "2": 2, "3": 2, "4": 1, "5": 1 } },
      },
      auth,
      {
        adminDeps: mkAdminDeps(),
        readClient: mkReadClient([{ pack_id: "student-course-grade", asset: v2 }]),
        writeClient: { from: () => ({ upsert: upsertMock }) },
      },
    );
    expect(result.status).toBe("ok");
    const written = upsertMock.mock.calls[0][0] as { asset: { templates: unknown[] } };
    expect(written.asset.templates).toHaveLength(v2.templates.length);
  });
});
