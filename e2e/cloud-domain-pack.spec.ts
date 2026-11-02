import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";
import { mkCloudPackJson } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";

// 云端域包合并加载（票 #57 / spec #53 目标②）：云端表里的合法 JSON 域包过收录检查后
// 出现在学生端可演练列表、可切换开练；非法域包不进入加载结果。
// 「合法」的完整口径（闸门强校验）由单测断言（domain-pack-gate / cloud-pack-asset），
// 此处 e2e 只验浏览器加载链路的合并与放出过滤接续。

// console 卫生：全用例期间页面不得出现 console.error/warning 或未捕获异常
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
});

/** mock 学生权限（无任何权限点）与空放出清单（未配置 = 全放） */
async function mockStudentSide(page: Page) {
  await page.route("**/rest/v1/user_roles*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/role_permissions*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/pack_exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  // 版本历史表（票 #62 加载层随资产表一并拉取）：空桩避免漏出真实请求（anon 401 打进 console 卫生）
  await createDomainPackVersionHistoryStub().attach(page);
}

test("云端合法域包出现在学生端列表，可切换开练出题", async ({ page }) => {
  await mockStudentSide(page);
  const cloudStub = createDomainPackAssetStub();
  cloudStub.rows.push({ pack_id: "cloud-fixture-pack", asset: mkCloudPackJson() });
  await cloudStub.attach(page);

  await page.goto("/?seed=42");
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  // 内置两包 + 云端域包同时可见（异步就绪后合并，不闪错）
  await expect(page.getByRole("button", { name: "学生-课程-成绩" })).toBeVisible();
  await expect(page.getByRole("button", { name: "云端夹具域包" })).toBeVisible({ timeout: 15000 });

  // 切换到云端域包开练：出题来自云端模板（题面含「云端夹具」前缀）
  await page.getByRole("button", { name: "云端夹具域包" }).click();
  await expect(page.getByText(/云端夹具第 \d+ 题/).first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".cm-editor")).toBeVisible();
});

test("云端非法域包不进入加载结果：学生端仅见内置两包", async ({ page }) => {
  await mockStudentSide(page);
  const cloudStub = createDomainPackAssetStub();
  // 模板数不足 25：契约快校验即拒（闸门口径）
  cloudStub.rows.push({ pack_id: "bad-pack", asset: mkCloudPackJson({ templates: [] }) });
  await cloudStub.attach(page);

  await page.goto("/?seed=42");
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  await expect(page.getByRole("button", { name: "学生-课程-成绩" })).toBeVisible();
  await expect(page.getByRole("button", { name: "员工-部门-薪资" })).toBeVisible();
  await expect(page.getByRole("button", { name: "夹具" })).toHaveCount(0);
});
