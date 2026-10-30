import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState } from "./helpers";

// T2 · 用户管理列表（issue #43 / spec #41）：离线 route-mock 覆盖列表渲染、搜索交互与分页切换。
// 权限两跳照 admin-console.spec.ts 的 mock 模式；/api/admin/users 按 query 参数回放不同页数据。
// 无权限调用 API 得 403 的鉴权行为在服务层单测断言（admin-service.test.ts），不在此重复。

const allUsers = [
  { userId: "u1", studentId: "2022110001", realName: "张三", nickname: "三三", email: "zhang@cuc.edu.cn", roles: ["学生", "助教"], banned: false, createdAt: "2026-10-02T10:00:00Z" },
  { userId: "u2", studentId: "2022110002", realName: "李四", nickname: null, email: "li@cuc.edu.cn", roles: ["学生"], banned: true, createdAt: "2026-10-01T09:00:00Z" },
  { userId: "u3", studentId: "2022110003", realName: "王五", nickname: "五五", email: "wang@cuc.edu.cn", roles: ["学生", "教师", "管理员"], banned: false, createdAt: "2026-09-30T08:00:00Z" },
];

/** /api/admin/users 离线桩：q=张三 只回第 1 条；否则按 page 回放（page=1 两条、page=2 一条），total 语义与搜索联动 */
async function mockUsersApi(page: Page) {
  await page.route("**/api/admin/users*", async (route: Route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q") ?? "";
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    const matched = q ? allUsers.filter((user) => user.realName === q) : allUsers;
    const pageSize = 2; // 缩小页宽以驱动分页交互（真实页宽 20）
    const users = matched.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ users, total: matched.length, page: pageNumber, pageSize }),
    });
  });
}

/** mock 当前用户（e2e-user）的管理员权限（照 admin-console.spec.ts 模式） */
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

test.beforeEach(async ({ page }) => {
  await presetLoginState(page);
  await mockAdminPermissions(page);
  await mockUsersApi(page);
});

test("列表渲染：字段齐全，角色徽章与账号状态正确", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户列表")).toBeVisible();

  const rows = page.getByTestId("用户行");
  await expect(rows).toHaveCount(2);

  // 学号/时间走等宽字体列，姓名/昵称/邮箱原样呈现
  await expect(rows.first()).toContainText("2022110001");
  await expect(rows.first()).toContainText("张三");
  await expect(rows.first()).toContainText("三三");
  await expect(rows.first()).toContainText("zhang@cuc.edu.cn");
  await expect(rows.first().getByTestId("用户角色")).toContainText("学生");
  await expect(rows.first().getByTestId("用户角色")).toContainText("助教");
  await expect(rows.first()).toContainText("正常");

  // 第二行：单角色 + 已禁用状态
  await expect(rows.nth(1).getByTestId("用户角色")).toContainText("学生");
  await expect(rows.nth(1)).toContainText("已禁用");

  await expect(page.getByTestId("用户列表统计")).toContainText("共 3 人");
});

test("搜索交互：提交搜索词后列表按 q 过滤", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户行")).toHaveCount(2);

  await page.getByTestId("用户搜索框").fill("张三");
  await page.getByRole("button", { name: "搜索" }).click();

  await expect(page.getByTestId("用户行")).toHaveCount(1);
  await expect(page.getByTestId("用户行").first()).toContainText("张三");
  await expect(page.getByTestId("用户列表统计")).toContainText("共 1 人");
});

test("分页切换：下一页/上一页往返，越界方向禁用", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page.getByTestId("用户行")).toHaveCount(2);

  await page.getByTestId("用户列表下一页").click();
  await expect(page.getByTestId("用户行")).toHaveCount(1);
  await expect(page.getByTestId("用户行").first()).toContainText("王五");
  await expect(page.getByTestId("用户列表统计")).toContainText("第 2/2 页");
  await expect(page.getByTestId("用户列表下一页")).toBeDisabled();

  await page.getByTestId("用户列表上一页").click();
  await expect(page.getByTestId("用户行")).toHaveCount(2);
  await expect(page.getByTestId("用户列表统计")).toContainText("第 1/2 页");
  await expect(page.getByTestId("用户列表上一页")).toBeDisabled();
});
