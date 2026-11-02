import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";
import { mkCloudPackJson } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";
import type { GateReport } from "../src/kernel/domain-pack-gate";

// 生成新域包独立页（票 #66 / spec #64）：教师直达 /admin/packs/generate，专属页面完成
// 「场景描述 → 同步等待 → 闸门报告 → 草稿摘要 → 确认发布/放弃草稿」全流程；
// 发布成功与放弃草稿两个终态均自动回到 /admin/packs（Next.js 路由跳转，非锚点）。
// 由 domain-pack-admin-page.spec.ts（单页混排时代）整体迁移而来。
// LLM 打桩设计与迁移前一致：浏览器 fetch 打 page.route 桩即可，服务端出站 DeepSeek
// 请求无法也无需在此拦截（真实协议边界由 domain-pack-generation.spec 直打路由覆盖）。
// 发布后回跳的列表页（/admin/packs）目前仍是六区块混排旧页（#70 删除），同页其余
// 区块的 API 桩（放出/演练配置/版本历史）保留，回跳后 console 保持卫生。

// console 卫生：全用例期间页面不得出现 console.error/warning 或未捕获异常。
// 例外过滤：本 spec 打桩的 502/503 失败响应会被浏览器记为资源加载错误（Failed to load resource …），
// 这是测试注入的预期失败、非页面缺陷，按「本流程 fetch 只打到 /api/admin/domain-packs」的用例事实过滤。
const STUBBED_FAILURE_RESOURCE = /Failed to load resource: the server responded with a status of (502|503)/;
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page).filter((m) => !STUBBED_FAILURE_RESOURCE.test(m));
  await presetLoginState(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
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

/** 回跳目标列表页（旧单页暂存，#70 删除）其余区块的 API 桩 + cloudPackStore 依赖表 */
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

  // 生成 API 桩：回放一份合法草稿（图书馆借阅）+ 通过态报告
  const draft = mkCloudPackJson({ packId: "library-borrow", name: "图书馆借阅" });
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
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
  await page.getByRole("button", { name: "确认发布" }).click();
  await expect(page).toHaveURL(/\/admin\/packs$/);
  await expect(page.getByTestId("域包行-图书馆借阅")).toContainText("云端");
  await expect(page.getByTestId("域包行-图书馆借阅")).toContainText("已放出（默认全放）");

  // —— 学生端：发布后的新域包可见、可切换开练 ——
  await page.route("**/rest/v1/pack_exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
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
