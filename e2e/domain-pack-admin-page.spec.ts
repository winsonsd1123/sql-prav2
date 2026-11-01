import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub } from "./helpers";
import { mkCloudPackJson } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";
import type { GateReport } from "../src/kernel/domain-pack-gate";

// 域包管理页（票 #60 / spec #53 目标②，AC：教师描述→生成→报告→发布全流程 + 发布后学生端可见可练）。
// LLM 打桩设计（取舍见施工记录）：Playwright 拦截的是浏览器发起的请求——本页对
// /api/admin/domain-packs/{generate,publish} 的 fetch 发生在浏览器内，直接 page.route 打桩即可；
// 服务端路由对 DeepSeek 的出站 fetch 无需也无法在此拦截（真实协议边界由 #59 的
// domain-pack-generation.spec 直打路由覆盖：400/401/503）。因此不为 e2e 引入任何
// 服务端测试开关（env flag/注入 fake provider），生产路径零改动、不可被测试态触发。
// 发布后的「学生端可见可练」用 #57 的 domain_pack_asset 浏览器桩回放已发布资产行。

// console 卫生：全用例期间页面不得出现 console.error/warning 或未捕获异常。
// 例外过滤：本 spec 打桩的 502/503 失败响应会被浏览器记为资源加载错误（Failed to load resource …），
// 这是测试注入的预期失败、非页面缺陷（真实路由的失败在 fetch 侧处理、不打进页面 console 逻辑），
// 按「本页自身 fetch 只打到 /api/admin/domain-packs」的用例事实过滤该类资源错误。
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

/** 管理页同页其余区块的 API 桩：放出清单（未配置=全放）+ 演练配置空视图 */
async function mockSiblingBlocks(page: Page) {
  await page.route("**/api/admin/pack-exposure", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });
  await page.route("**/api/admin/domain-packs/practice-config", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packs: [] }) });
  });
}

/** 通过态闸门报告夹具（三段全过，口径与 #56 GateReport 一致） */
const passedReport: GateReport = {
  passed: true,
  structural: { status: "通过", issues: [], checkedTables: 3, checkedTemplates: 30 },
  generation: { status: "通过", issues: [], seeds: [20260101, 42] },
  selfJudging: { status: "通过", issues: [], checkedTemplates: 30, seed: 20260101 },
};

test("教师描述→生成→验证报告→确认发布全流程，发布后学生端可见可开练", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockSiblingBlocks(page);
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

  await page.goto("/admin/packs");
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
  // —— 确认发布 → 成功反馈 ——
  await page.getByRole("button", { name: "确认发布" }).click();
  await expect(page.getByTestId("发布成功")).toContainText("library-borrow");
  // —— 管理页域包列表：新包出现，来源云端、默认放出 ——
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

test("生成失败（502）：明确错误 + 重试按钮，表单内容保留", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockSiblingBlocks(page);
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

  await page.goto("/admin/packs");
  await page.getByTestId("场景描述").fill("物流场景：仓库、货物、出入库记录");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("生成错误")).toContainText("LLM 网络请求失败");
  // 失败后表单内容保留（重试不重填）
  await expect(page.getByTestId("场景描述")).toHaveValue("物流场景：仓库、货物、出入库记录");
  // 重试 → 第二次成功进入报告态
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByTestId("验证报告")).toContainText("验证通过：可确认发布");
});

test("LLM 未配置（503）：提示需在服务端设置 DEEPSEEK_API_KEY", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockSiblingBlocks(page);
  await createDomainPackAssetStub().attach(page);
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "llm_not_configured", error: "LLM 未配置：请在服务端设置 DEEPSEEK_API_KEY" }),
    });
  });

  await page.goto("/admin/packs");
  await page.getByTestId("场景描述").fill("任意场景描述");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("生成错误")).toContainText("DEEPSEEK_API_KEY");
});

test("闸门拒绝（报告未通过）：逐条展示中文明细，无确认发布入口", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockSiblingBlocks(page);
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

  await page.goto("/admin/packs");
  await page.getByTestId("场景描述").fill("描述一个域包");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("验证报告")).toContainText("验证未通过");
  await expect(page.getByTestId("验证报告")).toContainText("模板数必须为 25-35");
  await expect(page.getByTestId("验证报告")).toContainText("跳过");
  await expect(page.getByRole("button", { name: "确认发布" })).toHaveCount(0);
});
