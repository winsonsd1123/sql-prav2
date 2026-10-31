import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems } from "./helpers";

// T5 · 邮箱白名单管理（issue #46 / spec #41）：离线 route-mock 覆盖配置展示、编辑保存载荷与总开关切换。
// 权限两跳照 admin-users.spec.ts 的 mock 模式；/api/admin/whitelist* 用内存状态回放（写操作改状态后重读可见）。
// 鉴权 401/403 行为在服务层单测断言（whitelist-admin-service.test.ts），不在此重复。

interface DomainEntry {
  domain: string;
  note: string | null;
}

/** /api/admin/whitelist* 离线桩：GET 回放内存状态；PUT/PATCH 记录载荷并更新状态（保存后刷新可见） */
async function mockWhitelistApi(page: Page) {
  const state = { allowAnyDomain: false, domains: [
    { domain: "cuc.edu.cn", note: "校内主域" },
    { domain: "bfsu.edu.cn", note: null },
  ] as DomainEntry[] };
  const calls = { putDomains: [] as unknown[], patchConfig: [] as unknown[] };

  await page.route("**/api/admin/whitelist", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ allowAnyDomain: state.allowAnyDomain, domains: state.domains }),
    });
  });
  await page.route("**/api/admin/whitelist/domains", async (route: Route) => {
    const body = route.request().postDataJSON() as { domains: DomainEntry[] };
    calls.putDomains.push(body);
    state.domains = body.domains;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/admin/whitelist/config", async (route: Route) => {
    const body = route.request().postDataJSON() as { allowAnyDomain: boolean };
    calls.patchConfig.push(body);
    state.allowAnyDomain = body.allowAnyDomain;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  return calls;
}

/** mock 当前用户（e2e-user）的管理员权限（照 admin-users.spec.ts 模式） */
async function mockAdminPermissions(page: Page) {
  await page.route("**/rest/v1/user_roles*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ user_id: "e2e-user", role: "管理员", created_at: "2026-01-01" }]),
    });
  });
  await page.route("**/rest/v1/role_permissions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ role: "管理员", permission: "访问后台", created_at: "2026-01-01" }]),
    });
  });
}

// console 卫生（spec #41 UI 强化）：全用例期间页面不得出现 console.error/warning 或未捕获异常
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
  await mockAdminPermissions(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
});

test("配置展示：总开关收紧状态与域名清单（含备注）", async ({ page }) => {
  await mockWhitelistApi(page);
  await page.goto("/admin/whitelist");

  await expect(page.getByTestId("白名单管理")).toBeVisible();
  await expect(page.getByTestId("白名单总开关")).toContainText("已收紧");
  await expect(page.getByTestId("白名单总开关")).toContainText("仅下方清单内域名可注册");
  await expect(page.getByTestId("域名行")).toHaveCount(2);
  const inputs = page.getByTestId("域名输入框");
  await expect(inputs.nth(0)).toHaveValue("cuc.edu.cn");
  await expect(page.getByTestId("域名备注输入框").nth(0)).toHaveValue("校内主域");
  await expect(page.getByTestId("域名清单统计")).toContainText("共 2 个域名");
});

test("编辑保存载荷：修改备注、新增与删除域名后，PUT 全量清单且保存后展示最新配置", async ({ page }) => {
  const calls = await mockWhitelistApi(page);
  await page.goto("/admin/whitelist");
  await expect(page.getByTestId("域名行")).toHaveCount(2);

  // 修改首条备注、删除第二条、新增一条
  await page.getByTestId("域名备注输入框").nth(0).fill("校内邮箱");
  await page.getByTestId("删除域名").nth(1).click();
  await page.getByTestId("新增域名").click();
  await page.getByTestId("域名输入框").nth(1).fill("stu.cuc.edu.cn");
  await page.getByTestId("保存域名清单").click();

  await expect(page.getByTestId("白名单提示")).toContainText("域名清单已保存");
  expect(calls.putDomains).toEqual([
    { domains: [{ domain: "cuc.edu.cn", note: "校内邮箱" }, { domain: "stu.cuc.edu.cn" }] },
  ]);
  // 保存后刷新展示最新配置（备注与新域名来自 mock 状态回放）
  await expect(page.getByTestId("域名行")).toHaveCount(2);
  await expect(page.getByTestId("域名备注输入框").nth(0)).toHaveValue("校内邮箱");
});

test("总开关切换：点击放开发出 PATCH 载荷并刷新为放开状态", async ({ page }) => {
  const calls = await mockWhitelistApi(page);
  await page.goto("/admin/whitelist");
  await expect(page.getByTestId("白名单总开关")).toContainText("已收紧");

  await page.getByTestId("白名单总开关").getByRole("button", { name: "放开" }).click();

  await expect(page.getByTestId("白名单提示")).toContainText("已放开任意域名注册");
  expect(calls.patchConfig).toEqual([{ allowAnyDomain: true }]);
  await expect(page.getByTestId("白名单总开关")).toContainText("已放开");
  await expect(page.getByTestId("白名单总开关")).toContainText("任何邮箱域名都可注册");
});
