import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, expectConsoleClean, stubPlaygroundBackend, mockAdmin, PACK_GROUP_LINK_LABELS } from "./helpers";

// 侧栏折叠 spec（票 #107 / spec #104 / ADR-0012 手写折叠）：宽屏折叠为约 64px 图标栏、
// rail 态 tooltip 菜单名、localStorage 持久化、再点展开还原。
// 断言口径与 admin-nav-structure.spec 一致：bounding box 视觉事实 + aria 属性，
// 不断言 class 名。窄屏形态零波及（归 admin-nav-structure.spec 持有，本 spec 不涉及）。

let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
  // 学生端演练场整页桩（review 修复 S2）：「返回演练场」用例导航至 /，漏桩即真连占位主机（#98 式 flake）。
  // Playwright 后注册路由优先：此处先挂，用例内 mockAdmin 再覆盖 user_roles 等。
  await stubPlaygroundBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
});
test.afterEach(() => {
  expectConsoleClean(consoleProblems);
});

/** 折叠按钮：唯一新增 testid，带 aria-expanded 状态语义 */
const collapseButton = (page: Page) => page.getByTestId("侧栏折叠按钮");

test("折叠：侧栏收窄至约 64px，文字不可见、组标题隐藏，aria-expanded=false", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();

  const aside = page.getByTestId("后台侧栏");
  const expandedBox = await aside.boundingBox();
  if (!expandedBox) throw new Error("侧栏未渲染出 bounding box");
  expect(expandedBox.width).toBeGreaterThan(200);

  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "true");
  await collapseButton(page).click();

  // 宽度收窄至约 64px 图标栏（过渡 200ms，轮询等收稳；允许取整误差）
  await expect
    .poll(async () => (await aside.boundingBox())?.width ?? 0, { timeout: 3_000 })
    .toBeLessThanOrEqual(76);
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");

  // 菜单文字不可见（链接仍在、图标仍在，label 视觉隐藏）
  await expect(page.getByTestId("后台侧边导航").getByText("用户管理", { exact: true })).toBeHidden();
  await expect(page.getByTestId("后台侧边导航").getByText("域包列表", { exact: true })).toBeHidden();
  // 组标题隐藏
  await expect(page.getByTestId("导航分组-域包管理")).toBeHidden();
  // 图标仍可见（域包组子项逐项直达，不做二级收纳）
  const subItem = page.getByTestId("后台侧边导航").getByRole("link", { name: "版本历史", exact: true });
  await expect(subItem).toBeVisible();

  // rail 态点击域包组子项图标直达对应页面
  await subItem.click();
  await expect(page).toHaveURL(/\/admin\/packs\/versions$/);
});

test("分组收起后切到 rail 态，域包组子项图标仍逐个直达", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();
  const group = page.getByTestId("导航分组-域包管理");
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");

  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");
  // rail 态不受分组展开态影响：触发器隐藏，子项图标全部可见
  await expect(group).toBeHidden();
  const nav = page.getByTestId("后台侧边导航");
  for (const label of PACK_GROUP_LINK_LABELS) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  // 展开侧栏后回到分组收起态
  await collapseButton(page).click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "版本历史", exact: true })).toBeHidden();
});

test("rail 态悬停菜单图标出 tooltip 菜单名，品牌区 logo tooltip「后台管理」", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();
  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");

  // 悬停直达项图标：tooltip 显示菜单名
  await page.getByTestId("后台侧边导航").getByRole("link", { name: "用户管理", exact: true }).hover();
  await expect(page.getByRole("tooltip", { name: "用户管理", exact: true })).toBeVisible();

  // 悬停域包组子项图标：tooltip 同样出菜单名
  await page.getByTestId("后台侧边导航").getByRole("link", { name: "演练配置", exact: true }).hover();
  await expect(page.getByRole("tooltip", { name: "演练配置", exact: true })).toBeVisible();

  // 品牌区收为仅 logo，tooltip「后台管理」
  await page.getByRole("img", { name: "后台 logo" }).hover();
  await expect(page.getByRole("tooltip", { name: "后台管理", exact: true })).toBeVisible();
});

test("持久化：折叠后刷新页面，折叠状态保持", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();
  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await expect(page.getByTestId("用户列表")).toBeVisible();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(
      async () => (await page.getByTestId("后台侧栏").boundingBox())?.width ?? 0,
      { timeout: 3_000 }
    )
    .toBeLessThanOrEqual(76);
});

// #108 rail 态账户区图标化：三出口均以图标呈现 + tooltip；「当前登录」标签隐藏。
// 图标元素承载既有 testid（当前账户邮箱 / 登出按钮），折叠时展开态元素 lg:hidden
// 仍在 DOM，故用 visible 过滤定位 rail 图标。
test("rail 态账户区：邮箱/登出/返回演练场图标化 + tooltip，「当前登录」隐藏", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();
  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");

  // 「当前登录」标签不可见；邮箱文本不再直接可见（收为图标）
  await expect(page.getByTestId("后台账户区").getByText("当前登录")).toBeHidden();
  await expect(
    page.getByTestId("当前账户邮箱").filter({ visible: true })
  ).toHaveCount(1);
  await expect(page.getByTestId("当前账户邮箱").filter({ visible: true })).not.toHaveText(
    "e2e@cuc.edu.cn"
  );

  // 悬停邮箱图标：tooltip 显示邮箱文本
  await page.getByTestId("当前账户邮箱").filter({ visible: true }).hover();
  await expect(page.getByRole("tooltip", { name: "e2e@cuc.edu.cn", exact: true })).toBeVisible();

  // 悬停登出图标：tooltip「登出」
  await page.getByTestId("登出按钮").filter({ visible: true }).hover();
  await expect(page.getByRole("tooltip", { name: "登出", exact: true })).toBeVisible();

  // 悬停返回演练场图标：tooltip「返回演练场」
  await page.getByTestId("后台账户区").getByRole("link", { name: "返回演练场", exact: true }).hover();
  await expect(page.getByRole("tooltip", { name: "返回演练场", exact: true })).toBeVisible();
});

// #108 rail 态账户区功能可用：登出可登出、返回演练场可返回
test("rail 态账户区：登出图标可登出、返回演练场图标可返回演练场", async ({ page }) => {
  await mockAdmin(page);
  await page.route("**/auth/v1/logout*", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();
  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");

  // 返回演练场图标直达演练场首页
  await page.getByTestId("后台账户区").getByRole("link", { name: "返回演练场", exact: true }).click();
  // 演练场首页可能带 seed 查询参数，断言 pathname 为根
  await expect
    .poll(async () => new URL(page.url()).pathname)
    .toBe("/");

  // 登出图标调用 auth logout 并跳转登录页（折叠态经 localStorage 持久化，回来即 rail）
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");
  const logoutRequest = page.waitForRequest("**/auth/v1/logout*");
  await page.getByTestId("登出按钮").filter({ visible: true }).click();
  expect((await logoutRequest).method()).toBe("POST");
  await expect(page).toHaveURL(/\/login$/);
});

// #108 展开态账户区回归：邮箱文本/标签/两按钮完整呈现
test("展开态账户区回归：邮箱文本、「当前登录」、两按钮可见且行为不变", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();

  // 默认展开：邮箱文本直接可见，「当前登录」标签可见，返回演练场为文字链接
  await expect(page.getByTestId("当前账户邮箱")).toHaveText("e2e@cuc.edu.cn");
  await expect(page.getByTestId("后台账户区").getByText("当前登录")).toBeVisible();
  await expect(page.getByTestId("后台账户区").getByRole("link", { name: "返回演练场", exact: true })).toBeVisible();

  // 折叠再展开：完整账户区回归
  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");
  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("当前账户邮箱").filter({ visible: true })).toHaveText("e2e@cuc.edu.cn");
  await expect(page.getByTestId("后台账户区").getByText("当前登录")).toBeVisible();
  await expect(page.getByTestId("登出按钮").filter({ visible: true })).toHaveText("登出");
});

test("还原：再点展开，完整菜单回归（文字、组标题、品牌标题）", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();
  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "false");

  await collapseButton(page).click();
  await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "true");

  // 宽度还原（lg:w-60 = 240px，过渡收稳后）
  await expect
    .poll(async () => (await page.getByTestId("后台侧栏").boundingBox())?.width ?? 0, { timeout: 3_000 })
    .toBeGreaterThan(200);

  // 菜单文字与组标题回归可见
  await expect(page.getByTestId("后台侧边导航").getByText("用户管理", { exact: true })).toBeVisible();
  await expect(page.getByTestId("后台侧边导航").getByText("域包列表", { exact: true })).toBeVisible();
  await expect(page.getByTestId("导航分组-域包管理")).toBeVisible();
  // 品牌标题回归（h1 heading 语义保留）
  await expect(page.getByRole("heading", { name: "后台管理", exact: true })).toBeVisible();
});
