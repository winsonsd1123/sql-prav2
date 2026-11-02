import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";
import { mkCloudPackJson } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";

// 域包版本历史独立页（票 #68 / spec #64）：/admin/packs/versions 支持 ?packId= 预选基础名
// 自动查询，参数缺失回退页内选择器。版本表口径不变（当前·新会话使用 | 历史·旧会话钉住）。
// 旧单页 refine 流程内的版本历史断言（domain-pack-refine.spec）由 #67 处置，此处不重复迁移。

// console 卫生：本 spec 打桩的响应均为 200，无需失败资源过滤。
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

/** 页面数据桩：云端一个 library-loan@v2 资产 + 版本历史表空（查询走 API 桩） */
async function attachPageStubs(page: Page) {
  const assetStub = createDomainPackAssetStub();
  assetStub.rows.push({
    pack_id: "library-loan@v2",
    asset: mkCloudPackJson({ packId: "library-loan@v2", name: "图书馆借阅" }),
  });
  await assetStub.attach(page);
  await createDomainPackVersionHistoryStub().attach(page);
}

/** 版本历史查询 API 桩：当前 v2 + 历史 v1（口径同 domain-pack-refine.spec） */
async function mockVersionsApi(page: Page) {
  await page.route("**/api/admin/domain-packs/versions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: [
          { packId: "library-loan@v2", versionLabel: "v2", name: "图书馆借阅", createdAt: "2026-11-01", isCurrent: true },
          { packId: "library-loan", versionLabel: "v1", name: "图书馆借阅", createdAt: "2026-10-01", isCurrent: false },
        ],
      }),
    });
  });
}

test("?packId= 预选基础名：直接访问即自动查询并展示版本表", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);

  await page.goto("/admin/packs/versions?packId=library-loan");
  // 无需手动选择：版本表自动出现，选择器已选中预选基础名
  await expect(page.getByTestId("版本历史目标域包")).toHaveValue("library-loan");
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
  await expect(page.getByTestId("版本历史列表")).toContainText("历史（旧会话钉住）");
});

test("无 packId 参数：回退页内选择器，手动选择后查询成功", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);

  await page.goto("/admin/packs/versions");
  // 未选择目标前不展示版本表，选择器停在占位项
  await expect(page.getByTestId("版本历史目标域包")).toHaveValue("");
  await expect(page.getByTestId("版本历史列表")).toHaveCount(0);
  // 页内选择器兜底：选中后查询，既有口径（当前/历史）不变
  await page.getByTestId("版本历史目标域包").selectOption("library-loan");
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
  await expect(page.getByTestId("版本历史列表")).toContainText("历史（旧会话钉住）");
});
