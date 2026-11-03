import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, expectConsoleClean, createCloudProgressStub, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";
import { mkCloudPackJson, CLOUD_FIXTURE_KNOWLEDGE_AREAS } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";
import type { GateReport } from "../src/kernel/domain-pack-gate";

// 生成新域包独立页（票 #66 / spec #64）：教师直达 /admin/packs/generate，专属页面完成
// 「场景描述 → 同步等待 → 闸门报告 → 草稿摘要 → 确认发布/放弃草稿」全流程；
// 发布成功与放弃草稿两个终态均自动回到 /admin/packs（Next.js 路由跳转，非锚点）。
// 由 domain-pack-admin-page.spec.ts（单页混排时代）整体迁移而来。
// LLM 打桩设计与迁移前一致：浏览器 fetch 打 page.route 桩即可，服务端出站 DeepSeek
// 请求无法也无需在此拦截（真实协议边界由 domain-pack-generation.spec 直打路由覆盖）。
// 发布后回跳的列表页（/admin/packs，#70 起为纯列表页）依赖的 API 桩
// （放出/演练配置/版本历史）保留，回跳后 console 保持卫生。

// console 卫生：全用例期间页面不得出现 console.error/warning 或未捕获异常。
// 仅桩 502/503 的失败用例豁免其资源加载报错（用例内置位标记），其余用例零豁免。
const STUBBED_FAILURE_RESOURCE = /Failed to load resource: the server responded with a status of (502|503)/;
let consoleProblems: string[] = [];
let stubbedFailureCase = false;
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  stubbedFailureCase = false;
  await presetLoginState(page);
});
test.afterEach(() => {
  expectConsoleClean(consoleProblems, stubbedFailureCase ? [STUBBED_FAILURE_RESOURCE] : []);
});

/** mock 教师权限（访问后台 + 域包管理）：页面与 API 的体验层放行 */
async function mockTeacherPermissions(page: Page) {
  await page.route("**/rest/v1/user_roles*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ user_id: "e2e-user", role: "教师", created_at: "2026-01-01" }]),
    });
  });
  await page.route("**/rest/v1/role_permissions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { role: "教师", permission: "访问后台", created_at: "2026-01-01" },
        { role: "教师", permission: "域包管理", created_at: "2026-01-01" },
      ]),
    });
  });
}

/** 回跳目标列表页（#70 起纯列表页）依赖的 API 桩 + cloudPackStore 依赖表 */
async function mockReturnTargetPage(page: Page) {
  await page.route("**/api/admin/pack-exposure", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });
  await page.route("**/api/admin/domain-packs/practice-config", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packs: [] }) });
  });
  // cloudPackStore 随资产表一并拉版本历史表，离线空桩保 console 卫生
  await createDomainPackVersionHistoryStub().attach(page);
}

/** 通过态闸门报告夹具（三段全过，口径与 #56 GateReport 一致） */
const passedReport: GateReport = {
  passed: true,
  structural: { status: "通过", issues: [], checkedTables: 3, checkedTemplates: 30 },
  generation: { status: "通过", issues: [], seeds: [20260101, 42] },
  selfJudging: { status: "通过", issues: [], checkedTemplates: 30, seed: 20260101 },
};

test("教师描述→生成→验证报告→确认发布全流程，发布成功后回到列表页且学生端可见可开练", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockReturnTargetPage(page);
  const assetStub = createDomainPackAssetStub();
  await assetStub.attach(page);

  // 生成 API 桩：回放一份合法草稿（图书馆借阅）+ 通过态报告；记录载荷供「未圈选零差异」断言
  let generatePayload: Record<string, unknown> | null = null;
  const draft = mkCloudPackJson({ packId: "library-borrow", name: "图书馆借阅" });
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
    generatePayload = route.request().postDataJSON() as Record<string, unknown>;
    // 模拟同步等待：让 loading 态可被断言后再回包（等待与页面状态无关，用独立计时器）
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft, report: passedReport }),
    });
  });
  // 发布 API 桩：确认后把草稿写进云端资产桩（学生端据此可见），回包 packId
  await page.route("**/api/admin/domain-packs/publish", async (route: Route) => {
    const body = route.request().postDataJSON() as { pack: { packId?: string } };
    if (body.pack?.packId) assetStub.rows.push({ pack_id: body.pack.packId, asset: body.pack });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, packId: body.pack?.packId ?? "library-borrow" }),
    });
  });

  await page.goto("/admin/packs/generate");
  // —— 生成表单 → 同步等待态 ——
  await page.getByTestId("场景描述").fill("图书馆借阅场景：读者、图书、借阅记录");
  await page.getByTestId("表数意愿").fill("3");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("生成等待提示")).toContainText("正在生成");
  // —— 验证报告：三段状态 + 可发布 ——
  await expect(page.getByTestId("验证报告")).toBeVisible();
  await expect(page.getByTestId("验证报告")).toContainText("验证通过：可确认发布");
  await expect(page.getByTestId("验证报告")).toContainText("结构检查");
  await expect(page.getByTestId("验证报告")).toContainText("生成检查");
  await expect(page.getByTestId("验证报告")).toContainText("自判检查");
  // —— 草稿摘要（名称/表数/模板数/五档分布）——
  await expect(page.getByTestId("草稿摘要")).toContainText("图书馆借阅");
  await expect(page.getByTestId("草稿摘要")).toContainText("3 张表");
  // —— 确认发布 → 终态回跳：回到 /admin/packs，新包出现在列表（来源云端、默认放出）——
  // 未圈选（票 #82 两态之一）：请求载荷不携带 knowledgeAreaIds，与现状零差异
  expect(generatePayload).not.toHaveProperty("knowledgeAreaIds");
  await page.getByRole("button", { name: "确认发布" }).click();
  await expect(page).toHaveURL(/\/admin\/packs$/);
  await expect(page.getByTestId("域包行-图书馆借阅")).toContainText("云端");
  await expect(page.getByTestId("域包行-图书馆借阅")).toContainText("已放出（默认全放）");

  // —— 学生端：发布后的新域包可见、可切换开练 ——
  await page.route("**/rest/v1/pack_exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await createCloudProgressStub().attach(page);
  await page.goto("/?seed=42");
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  await expect(page.getByRole("button", { name: "图书馆借阅" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "图书馆借阅" }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
});

test("放弃草稿：终态自动回到 /admin/packs", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockReturnTargetPage(page);
  await createDomainPackAssetStub().attach(page);
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: mkCloudPackJson({ packId: "library-borrow", name: "图书馆借阅" }), report: passedReport }),
    });
  });

  await page.goto("/admin/packs/generate");
  await page.getByTestId("场景描述").fill("图书馆借阅场景：读者、图书、借阅记录");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("验证报告")).toContainText("验证通过：可确认发布");
  // 放弃草稿 → 回到列表页
  await page.getByRole("button", { name: "放弃本次草稿" }).click();
  await expect(page).toHaveURL(/\/admin\/packs$/);
});

test("生成失败（502）：明确错误 + 重试按钮，表单内容保留", async ({ page }) => {
  stubbedFailureCase = true; // 本用例桩 502，豁免其资源加载报错（仅本用例）
  await mockTeacherPermissions(page);
  await mockReturnTargetPage(page);
  await createDomainPackAssetStub().attach(page);
  let calls = 0;
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ code: "llm_error", error: "LLM 网络请求失败，可重试", retryable: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: mkCloudPackJson(), report: passedReport }),
    });
  });

  await page.goto("/admin/packs/generate");
  await page.getByTestId("场景描述").fill("物流场景：仓库、货物、出入库记录");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("生成错误")).toContainText("LLM 网络请求失败");
  // 失败后表单内容保留（重试不重填），且停留在生成页（失败不回跳）
  await expect(page.getByTestId("场景描述")).toHaveValue("物流场景：仓库、货物、出入库记录");
  await expect(page).toHaveURL(/\/admin\/packs\/generate$/);
  // 重试 → 第二次成功进入报告态
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByTestId("验证报告")).toContainText("验证通过：可确认发布");
});

test("LLM 未配置（503）：提示需在服务端设置 DEEPSEEK_API_KEY", async ({ page }) => {
  stubbedFailureCase = true; // 本用例桩 503，豁免其资源加载报错（仅本用例）
  await mockTeacherPermissions(page);
  await mockReturnTargetPage(page);
  await createDomainPackAssetStub().attach(page);
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "llm_not_configured", error: "LLM 未配置：请在服务端设置 DEEPSEEK_API_KEY" }),
    });
  });

  await page.goto("/admin/packs/generate");
  await page.getByTestId("场景描述").fill("任意场景描述");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("生成错误")).toContainText("DEEPSEEK_API_KEY");
});

test("闸门拒绝（报告未通过）：逐条展示中文明细，无确认发布入口", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockReturnTargetPage(page);
  await createDomainPackAssetStub().attach(page);
  const failedReport: GateReport = {
    passed: false,
    structural: {
      status: "失败",
      checkedTables: 0,
      checkedTemplates: 0,
      issues: [{ check: "结构", message: "templates：模板数必须为 25-35，实际 10" }],
    },
    generation: { status: "跳过", issues: [], seeds: [20260101, 42] },
    selfJudging: { status: "跳过", issues: [], checkedTemplates: 0, seed: 20260101 },
  };
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: { packId: "bad-pack" }, report: failedReport }),
    });
  });

  await page.goto("/admin/packs/generate");
  await page.getByTestId("场景描述").fill("描述一个域包");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("验证报告")).toContainText("验证未通过");
  await expect(page.getByTestId("验证报告")).toContainText("模板数必须为 25-35");
  await expect(page.getByTestId("验证报告")).toContainText("跳过");
  await expect(page.getByRole("button", { name: "确认发布" })).toHaveCount(0);
});

// ── 圈选知识点（票 #82 / spec #75，ADR 0010「圈选即封闭」）：两态的页面级契约 ──
// 圈选器数据源为词表启用条目（停用条目不可圈选）；圈选生成的请求携带 knowledgeAreaIds，
// 产出清单 ⊆ 圈选集合、发布载荷带词表引用形态（knowledgeAreaRefIds，#83）。
// 封闭性强制的服务端行为（提示词注入 + 闸门越界拒绝）在服务层单测覆盖（服务端出站 LLM 无法被 Playwright 拦截）。
const VOCAB_IDS = ["ka-1", "ka-2", "ka-3", "ka-4", "ka-5", "ka-6", "ka-7"];

test("圈选生成：圈选器只列启用条目，请求携带圈选 id，产出清单取自圈选集合且发布带词表引用形态", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockReturnTargetPage(page);
  const assetStub = createDomainPackAssetStub();
  await assetStub.attach(page);

  // 词表桩：夹具七知识点全启用 + 一条停用条目（停用不可被新圈选，不应出现在圈选器）
  await page.route("**/api/admin/knowledge-areas", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: [
          ...CLOUD_FIXTURE_KNOWLEDGE_AREAS.map((name, i) => ({
            id: VOCAB_IDS[i],
            name,
            description: `「${name}」的考察要点`,
            active: true,
            referencedBy: [],
          })),
          { id: "ka-inactive", name: "窗口函数", description: "已停用的知识点", active: false, referencedBy: [] },
        ],
      }),
    });
  });

  const captured: { generate?: Record<string, unknown>; publish?: { pack?: { knowledgeAreas?: string[]; knowledgeAreaRefIds?: string[] } } } = {};
  const selectedDraft = mkCloudPackJson({ packId: "selected-pack", knowledgeAreaRefIds: VOCAB_IDS });
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
    captured.generate = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: selectedDraft, report: passedReport }),
    });
  });
  await page.route("**/api/admin/domain-packs/publish", async (route) => {
    captured.publish = route.request().postDataJSON() as { pack?: { knowledgeAreas?: string[]; knowledgeAreaRefIds?: string[] } };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, packId: "selected-pack" }),
    });
  });

  await page.goto("/admin/packs/generate");
  // —— 展开圈选器：列出启用条目（含描述），停用条目不出现 ——
  await page.getByTestId("圈选知识点开关").click();
  const selector = page.getByTestId("圈选知识点");
  await expect(selector).toBeVisible();
  await expect(page.getByTestId("圈选项-单表查询与投影")).toContainText("「单表查询与投影」的考察要点");
  await expect(page.getByTestId("圈选项-窗口函数")).toHaveCount(0);
  // —— 圈选全部启用条目 → 生成 ——
  for (const name of CLOUD_FIXTURE_KNOWLEDGE_AREAS) {
    await page.getByTestId(`圈选项-${name}`).locator("input").check();
  }
  await page.getByTestId("场景描述").fill("图书馆借阅场景：读者、图书、借阅记录");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("验证报告")).toContainText("验证通过：可确认发布");
  // 请求载荷携带圈选 id（与圈选顺序一致）
  expect(captured.generate?.knowledgeAreaIds).toEqual(VOCAB_IDS);
  // —— 确认发布：产出清单 ⊆ 圈选集合（名称层面），发布载荷为词表引用形态 ——
  const selectedNames = new Set<string>(CLOUD_FIXTURE_KNOWLEDGE_AREAS);
  await page.getByRole("button", { name: "确认发布" }).click();
  // 发布成功 → 终态回跳列表页（与既有用例同口径；载荷断言不依赖页面停留）
  await expect(page).toHaveURL(/\/admin\/packs$/);
  const pack = captured.publish?.pack;
  expect(pack?.knowledgeAreas?.every((area: string) => selectedNames.has(area))).toBe(true);
  expect(pack?.knowledgeAreaRefIds).toEqual(VOCAB_IDS);
});
