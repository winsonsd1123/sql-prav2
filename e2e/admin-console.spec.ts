import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createCloudProgressStub } from "./helpers";

// T1 · 后台管理骨架（issue #42 / spec #41，ADR-0005 / ADR-0007）：
// 持「访问后台」权限点（mock 管理员）→ 演练场顶部入口可见、/admin 骨架页与侧边导航可达；
// 无权限点 → 入口不可见、直访被重定向回演练场；未登录 → 引导登录。
// #50 起追加全高侧栏布局断言（桌面纵向 / 窄屏横排）。
// 界面显隐仅为体验层，安全边界在 API 层（后续票）。

// console 卫生（用户指令加严）：全用例期间页面不得出现 console.error/warning 或未捕获异常
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
});

test.describe("已登录", () => {
  test.beforeEach(async ({ page }) => {
    await presetLoginState(page);
    // 演练场页会拉取云端进度，假 token 直连真库得 401 并污染 console 卫生断言
    await createCloudProgressStub().attach(page);
  });

  /** mock 当前用户（e2e-user）的管理员权限：user_roles → role_permissions 两跳均以 REST 拦截（表名英文，glob 直配） */
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
        body: JSON.stringify([
          { role: "管理员", permission: "访问后台", created_at: "2026-01-01" },
        ]),
      });
    });
  }

  /** 无权限点：mock 学生角色（学生不挂任何权限点；不用 route.abort，postgrest 客户端对网络错误带重试退避会拖慢用例） */
  async function mockStudentPermissions(page: Page) {
    await page.route("**/rest/v1/user_roles*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ user_id: "e2e-user", role: "学生", created_at: "2026-01-01" }]),
      });
    });
    await page.route("**/rest/v1/role_permissions*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
  }

  /** 后台页面 API 离线桩：空态即可，列表与白名单交互细节见 admin-users / admin-whitelist spec */
  async function mockAdminPageApis(page: Page) {
    await page.route("**/api/admin/users*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ users: [], total: 0, page: 1, pageSize: 20 }),
      });
    });
    await page.route("**/api/admin/whitelist", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ allowAnyDomain: false, domains: [] }),
      });
    });
  }

  test("持「访问后台」：入口可见，进入 /admin 重定向至用户管理页", async ({ page }) => {
    await mockAdminPermissions(page);
    await mockAdminPageApis(page);
    await page.goto("/?seed=42");
    await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();

    await page.getByTestId("后台管理入口").click();
    // /admin 重定向至用户管理页
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole("heading", { name: "后台管理", exact: true })).toBeVisible();
    await expect(page.getByTestId("用户列表")).toBeVisible();

    // 侧边导航两项俱在，当前项（用户管理）高亮
    const nav = page.getByTestId("后台侧边导航");
    await expect(nav.getByRole("link", { name: "用户管理" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "邮箱白名单" })).toBeVisible();

    // 可切换至邮箱白名单页
    await nav.getByRole("link", { name: "邮箱白名单" }).click();
    await expect(page).toHaveURL(/\/admin\/whitelist$/);
    await expect(page.getByTestId("白名单管理")).toBeVisible();
  });

  /** 入场动画含 translateY，量 bounding box 前须等动画落定 */
  async function waitForAnimationsSettled(page: Page) {
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState === "finished"),
    );
  }

  // #50 全高侧栏：断言视觉事实（bounding box），不断言 class 名。默认视口 1280x720 ≥ lg
  test("桌面：全高侧栏，品牌区在顶、菜单纵向、返回演练场在底，内容区居右", async ({ page }) => {
    await mockAdminPermissions(page);
    await mockAdminPageApis(page);
    await page.goto("/admin/users");
    await expect(page.getByTestId("用户列表")).toBeVisible();
    await waitForAnimationsSettled(page);

    const sidebar = page.getByTestId("后台侧栏");
    const nav = page.getByTestId("后台侧边导航");
    const users = await nav.getByRole("link", { name: "用户管理" }).boundingBox();
    const whitelist = await nav.getByRole("link", { name: "邮箱白名单" }).boundingBox();
    const brand = await page.getByRole("heading", { name: "后台管理", exact: true }).boundingBox();
    const back = await sidebar.getByRole("link", { name: "返回演练场" }).boundingBox();
    const box = await sidebar.boundingBox();
    const content = await page.getByTestId("用户列表").boundingBox();
    const viewport = page.viewportSize();
    if (!users || !whitelist || !brand || !back || !box || !content || !viewport) {
      throw new Error("布局元素未渲染出 bounding box");
    }

    // 菜单纵向排列
    expect(whitelist.x).toBe(users.x);
    expect(whitelist.y).toBeGreaterThan(users.y);
    // 品牌区在顶、返回演练场在底
    expect(brand.y).toBeLessThan(users.y);
    expect(back.y).toBeGreaterThan(whitelist.y);
    // 全高：侧栏几乎占满视口高度，返回演练场贴近侧栏底部
    expect(box.height).toBeGreaterThan(viewport.height * 0.9);
    expect(box.y + box.height - (back.y + back.height)).toBeLessThan(48);
    // 宽度落在主流惯例区间
    expect(box.width).toBeGreaterThanOrEqual(220);
    expect(box.width).toBeLessThanOrEqual(256);
    // 内容区在侧栏右侧
    expect(content.x).toBeGreaterThan(box.x + box.width);
  });

  test("窄屏：导航退化为顶部横排且可切换", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await mockAdminPermissions(page);
    await mockAdminPageApis(page);
    await page.goto("/admin/users");
    await expect(page.getByTestId("用户列表")).toBeVisible();
    await waitForAnimationsSettled(page);

    const nav = page.getByTestId("后台侧边导航");
    const users = await nav.getByRole("link", { name: "用户管理" }).boundingBox();
    const whitelist = await nav.getByRole("link", { name: "邮箱白名单" }).boundingBox();
    const navBox = await nav.boundingBox();
    const content = await page.getByTestId("用户列表").boundingBox();
    if (!users || !whitelist || !navBox || !content) throw new Error("布局元素未渲染出 bounding box");

    // 菜单横排，且导航位于内容区上方
    expect(whitelist.y).toBe(users.y);
    expect(whitelist.x).toBeGreaterThan(users.x);
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(content.y);

    await nav.getByRole("link", { name: "邮箱白名单" }).click();
    await expect(page).toHaveURL(/\/admin\/whitelist$/);
    await expect(nav.getByRole("link", { name: "邮箱白名单" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("白名单管理")).toBeVisible();
  });

  test("无权限点：不见入口，直访 /admin 被重定向回演练场", async ({ page }) => {
    await mockStudentPermissions(page);
    await page.goto("/?seed=42");
    await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
    await expect(page.getByTestId("后台管理入口")).toBeHidden();

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  });
});

test.describe("未登录", () => {
  test("直访 /admin 被引导登录", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
  });
});
