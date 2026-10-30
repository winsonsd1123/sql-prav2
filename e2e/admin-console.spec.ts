import { test, expect, type Page } from "@playwright/test";
import { presetLoginState } from "./helpers";

// T1 · 后台管理骨架（issue #42 / spec #41，ADR-0005 / ADR-0007）：
// 持「访问后台」权限点（mock 管理员）→ 演练场顶部入口可见、/admin 骨架页与侧边导航可达；
// 无权限点 → 入口不可见、直访被重定向回演练场；未登录 → 引导登录。
// 界面显隐仅为体验层，安全边界在 API 层（后续票）。

test.describe("已登录", () => {
  test.beforeEach(async ({ page }) => {
    await presetLoginState(page);
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

  test("持「访问后台」：入口可见，进入 /admin 重定向至用户管理页", async ({ page }) => {
    await mockAdminPermissions(page);
    // 用户列表 API 离线桩（T2 起页面接入真实数据）：空态即可，列表交互细节见 admin-users.spec.ts
    await page.route("**/api/admin/users*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ users: [], total: 0, page: 1, pageSize: 20 }),
      });
    });
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

    // 可切换至邮箱白名单骨架页
    await nav.getByRole("link", { name: "邮箱白名单" }).click();
    await expect(page).toHaveURL(/\/admin\/whitelist$/);
    await expect(page.getByTestId("邮箱白名单骨架")).toBeVisible();
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
