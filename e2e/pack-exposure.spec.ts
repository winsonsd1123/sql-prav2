import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems } from "./helpers";

// 域包放出（issue #55 / spec #53 目标③）：教师后台勾选放出 → 学生端只见表中的域包；
// 未配置（清单空）默认全部放出。鉴权 401/403 行为在服务层单测断言，不在此重复。

// console 卫生：全用例期间页面不得出现 console.error/warning 或未捕获异常
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
});

/** mock 学生权限（无任何权限点）：演练场会拉取当前权限以决定入口显隐 */
async function mockStudentPermissions(page: Page) {
  await page.route("**/rest/v1/user_roles*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/role_permissions*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

/** mock 教师权限（访问后台 + 域包管理）：后台守卫与放出管理 API 的体验层放行 */
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

/** /api/admin/pack-exposure 有状态桩：GET 回放内存状态；PUT 记录载荷并更新状态（保存后刷新可见） */
async function mockPackExposureAdminApi(page: Page) {
  const state = { packIds: [] as string[] };
  const calls = { put: [] as string[][] };
  await page.route("**/api/admin/pack-exposure", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ packIds: state.packIds }),
      });
      return;
    }
    const body = route.request().postDataJSON() as { packIds: string[] };
    calls.put.push(body.packIds);
    state.packIds = body.packIds;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  return calls;
}

/** 学生端 pack_exposure REST 桩：回放给定的放出 packId 行集（空数组 = 未配置） */
async function mockPackExposureRows(page: Page, packIds: string[]) {
  await page.route("**/rest/v1/pack_exposure*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(packIds.map((pack_id) => ({ pack_id }))),
    });
  });
}

/** 学生端 domain_pack_asset REST 桩（#57）：回放云端域包资产行集（空数组 = 云端无域包） */
async function mockDomainPackAssetRows(page: Page, rows: unknown[]) {
  await page.route("**/rest/v1/domain_pack_asset*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });
}

test("未配置（清单空）默认全部放出：学生端两个域包胶囊均可见", async ({ page }) => {
  await mockStudentPermissions(page);
  await mockPackExposureRows(page, []);
  await mockDomainPackAssetRows(page, []);
  await page.goto("/?seed=42");
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  await expect(page.getByRole("button", { name: "学生-课程-成绩" })).toBeVisible();
  await expect(page.getByRole("button", { name: "员工-部门-薪资" })).toBeVisible();
});

test("教师勾选放出单个域包并保存：PUT 全量清单，学生端只见放出的域包", async ({ page }) => {
  // —— 教师端：后台勾选放出「学生-课程-成绩」并保存 ——
  await mockTeacherPermissions(page);
  const calls = await mockPackExposureAdminApi(page);
  await page.goto("/admin/packs");
  await expect(page.getByTestId("域包放出管理")).toBeVisible();
  // 未配置时从「全放」出发编辑：取消勾选「员工-部门-薪资」
  await page.getByTestId("放出勾选-员工-部门-薪资").click();
  await page.getByRole("button", { name: "保存放出清单" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(calls.put).toEqual([["student-course-grade"]]);

  // —— 学生端：清单只含「学生-课程-成绩」→ 未放出的域包完全不可见 ——
  await mockPackExposureRows(page, calls.put[0]);
  await mockDomainPackAssetRows(page, []);
  await page.goto("/?seed=42");
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  await expect(page.getByRole("button", { name: "学生-课程-成绩" })).toBeVisible();
  await expect(page.getByRole("button", { name: "员工-部门-薪资" })).toHaveCount(0);
});
