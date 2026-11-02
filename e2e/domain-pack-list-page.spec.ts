import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";

// 域包列表页 contract（票 #70 / spec #64）：/admin/packs 从六区块混排旧页换成纯列表页——
// 页顶「新建域包」→ 生成页；行内「微调」「版本历史」携带 ?packId= 跨页跳转且目标页预选；
// 其余功能区块（生成表单 / 微调 / 版本历史 / 放出 / 演练配置）不再混排本页。
// 导航四子项挂全由本票接线（结构渲染与选中态全量收口在 #71 导航 spec）。

let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
});

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

/** 列表页数据桩：云端资产表空（只展示内置两包）+ 放出清单空（默认全放）+
 *  cloudPackStore 同源拉取的版本历史表空桩（跳转目标页时保 console 卫生） */
async function attachListPageStubs(page: Page) {
  await createDomainPackAssetStub().attach(page);
  await createDomainPackVersionHistoryStub().attach(page);
  await page.route("**/api/admin/pack-exposure*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ packIds: [] }),
    });
  });
  await page.route("**/api/admin/domain-packs/practice-config*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packs: [] }) });
  });
}

test("根路径为纯列表页：无其他功能区块混排，页顶「新建域包」进入生成页", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachListPageStubs(page);

  await page.goto("/admin/packs");
  await expect(page.getByTestId("域包行-学生-课程-成绩")).toContainText("已放出（默认全放）");
  // 旧六区块不再混排本页（生成表单 / 微调 / 版本历史 / 放出 / 演练配置区块均不存在）
  await expect(page.getByTestId("场景描述")).toHaveCount(0);
  await expect(page.getByTestId("修改意图")).toHaveCount(0);
  await expect(page.getByTestId("版本历史目标域包")).toHaveCount(0);
  await expect(page.getByTestId("域包放出管理")).toHaveCount(0);
  await expect(page.getByTestId("演练配置管理")).toHaveCount(0);

  // 页顶「新建域包」→ 生成页（Link 形态的入口，可右键开新页）
  await page.getByRole("link", { name: "新建域包" }).click();
  await expect(page).toHaveURL(/\/admin\/packs\/generate$/);
  await expect(page.getByTestId("场景描述")).toBeVisible();
});

test("行内「微调」携带 packId 跳转微调页且目标包已预选", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachListPageStubs(page);

  await page.goto("/admin/packs");
  await page.getByTestId("微调入口-学生-课程-成绩").click();
  await expect(page).toHaveURL(/\/admin\/packs\/refine\?packId=/);
  await expect(page.getByTestId("微调目标域包")).toHaveValue("student-course-grade");
});

test("行内「版本历史」携带 packId 跳转历史页且已预选查询", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachListPageStubs(page);
  await createDomainPackVersionHistoryStub().attach(page);
  await page.route("**/api/admin/domain-packs/versions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: [
          { packId: "student-course-grade", versionLabel: "v1", name: "学生-课程-成绩", createdAt: "2026-10-01", isCurrent: true },
        ],
      }),
    });
  });

  await page.goto("/admin/packs");
  await page.getByTestId("版本历史入口-学生-课程-成绩").click();
  await expect(page).toHaveURL(/\/admin\/packs\/versions\?packId=/);
  await expect(page.getByTestId("版本历史目标域包")).toHaveValue("student-course-grade");
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
});

test("导航挂全四个子项且各指向正确路由", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachListPageStubs(page);

  await page.goto("/admin/packs");
  const nav = page.getByTestId("后台侧边导航");
  await nav.getByRole("link", { name: "域包列表" }).click();
  await expect(page).toHaveURL(/\/admin\/packs$/);
  await nav.getByRole("link", { name: "版本历史" }).click();
  await expect(page).toHaveURL(/\/admin\/packs\/versions$/);
  await nav.getByRole("link", { name: "放出管理" }).click();
  await expect(page).toHaveURL(/\/admin\/packs\/exposure$/);
  await nav.getByRole("link", { name: "演练配置" }).click();
  await expect(page).toHaveURL(/\/admin\/packs\/practice-config$/);
});
