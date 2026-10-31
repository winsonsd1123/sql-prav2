import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems } from "./helpers";

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

// console 卫生（spec #41 UI 强化）：全用例期间页面不得出现 console.error/warning 或未捕获异常
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
  await mockAdminPermissions(page);
  await mockUsersApi(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
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

// ══════════════ T3 · 角色分配与回收（issue #44）══════════════
// 行内角色编辑：全量集合保存载荷、保存后徽章更新、自我保护禁用态（体验层；服务端强制在单测断言）。

test.describe("角色行内编辑", () => {
  /** PUT /api/admin/users/:id/roles 桩：捕获请求（方法/头/载荷），回放保存后的集合 */
  async function mockRolesPutApi(page: Page) {
    const received: { url: string; method: string; authorization: string | null; body: unknown }[] = [];
    await page.route("**/api/admin/users/*/roles", async (route: Route) => {
      const request = route.request();
      received.push({
        url: request.url(),
        method: request.method(),
        authorization: request.headers()["authorization"] ?? null,
        body: request.postDataJSON(),
      });
      const body = request.postDataJSON() as { roles: string[] };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ roles: body.roles }) });
    });
    return received;
  }

  test("保存载荷正确：编辑行内勾选后 PUT 全量集合，徽章即时更新", async ({ page }) => {
    const received = await mockRolesPutApi(page);
    await page.goto("/admin/users");
    const firstRow = page.getByTestId("用户行").first();
    await expect(firstRow.getByTestId("用户角色")).toContainText("助教");

    await firstRow.getByTestId("角色编辑").click();
    // 取消「助教」、勾上「教师」→ 全量集合应为 [学生, 教师]
    await firstRow.getByTestId("角色复选-助教").uncheck();
    await firstRow.getByTestId("角色复选-教师").check();
    await firstRow.getByTestId("角色保存").click();

    await expect(firstRow.getByTestId("角色编辑")).toBeVisible(); // 编辑器收起即保存完成
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("PUT");
    expect(received[0].url).toContain("/api/admin/users/u1/roles");
    expect(received[0].authorization).toBe("Bearer e2e-access-token");
    expect(received[0].body).toEqual({ roles: ["学生", "教师"] });

    await expect(firstRow.getByTestId("用户角色")).toContainText("学生");
    await expect(firstRow.getByTestId("用户角色")).toContainText("教师");
    await expect(firstRow.getByTestId("用户角色")).not.toContainText("助教");
  });

  test("自我保护：自己那一行「管理员」复选禁用并附提示（体验层）", async ({ page }) => {
    // 覆盖列表桩：把当前会话用户（e2e-user）放进列表
    await page.route("**/api/admin/users*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          users: [{ userId: "e2e-user", studentId: "2022110000", realName: "本人", nickname: null, email: "me@cuc.edu.cn", roles: ["学生", "管理员"], banned: false, createdAt: "2026-10-01T00:00:00Z" }],
          total: 1, page: 1, pageSize: 20,
        }),
      });
    });
    await page.goto("/admin/users");
    const selfRow = page.getByTestId("用户行").first();
    await selfRow.getByTestId("角色编辑").click();

    const adminCheckbox = selfRow.getByTestId("角色复选-管理员");
    await expect(adminCheckbox).toBeVisible();
    await expect(adminCheckbox).toBeDisabled();
    await expect(adminCheckbox).toBeChecked(); // 自己的管理员角色保持选中且不可取消
    await expect(selfRow.getByTestId("角色编辑器")).toContainText("「管理员」不可自行回收");
    // 其他角色不受影响
    await expect(selfRow.getByTestId("角色复选-学生")).toBeEnabled();
  });
});

// ══════════════ T4 · 账号禁用与启用（issue #45）══════════════
// 行内禁用/启用：PATCH 载荷与状态列即时更新、自我保护按钮禁用态（体验层；服务端强制在单测断言）。

test.describe("账号禁用与启用", () => {
  /** PATCH /api/admin/users/:id 桩：捕获请求（方法/头/载荷），回放请求的 banned 值 */
  async function mockBanPatchApi(page: Page) {
    const received: { url: string; method: string; authorization: string | null; body: unknown }[] = [];
    await page.route("**/api/admin/users/*", async (route: Route) => {
      if (route.request().method() !== "PATCH") {
        await route.fallback();
        return;
      }
      const request = route.request();
      const body = request.postDataJSON() as { banned: boolean };
      received.push({ url: request.url(), method: request.method(), authorization: request.headers()["authorization"] ?? null, body });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ banned: body.banned }) });
    });
    return received;
  }

  test("禁用→启用：PATCH 载荷正确，状态列即时更新", async ({ page }) => {
    const received = await mockBanPatchApi(page);
    await page.goto("/admin/users");
    const firstRow = page.getByTestId("用户行").first(); // u1 张三，初始「正常」
    await expect(firstRow.getByTestId("账号状态")).toContainText("正常");

    // 禁用：载荷 { banned: true }，状态列翻为「已禁用」，按钮切换为「启用」
    await firstRow.getByTestId("禁用启用按钮").click();
    await expect(firstRow.getByTestId("账号状态")).toContainText("已禁用");
    await expect(firstRow.getByTestId("禁用启用按钮")).toHaveText("启用");
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("PATCH");
    expect(received[0].url).toContain("/api/admin/users/u1");
    expect(received[0].url).not.toContain("/roles");
    expect(received[0].authorization).toBe("Bearer e2e-access-token");
    expect(received[0].body).toEqual({ banned: true });

    // 启用：载荷 { banned: false }，状态列翻回「正常」
    await firstRow.getByTestId("禁用启用按钮").click();
    await expect(firstRow.getByTestId("账号状态")).toContainText("正常");
    await expect(firstRow.getByTestId("禁用启用按钮")).toHaveText("禁用");
    expect(received[1].body).toEqual({ banned: false });
  });

  test("自我保护：自己那一行禁用按钮禁用并附提示，启用他人不受影响（体验层）", async ({ page }) => {
    // 覆盖列表桩：把当前会话用户（e2e-user）放进列表
    await page.route("**/api/admin/users?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          users: [
            { userId: "e2e-user", studentId: "2022110000", realName: "本人", nickname: null, email: "me@cuc.edu.cn", roles: ["学生", "管理员"], banned: false, createdAt: "2026-10-01T00:00:00Z" },
            { userId: "u2", studentId: "2022110002", realName: "李四", nickname: null, email: "li@cuc.edu.cn", roles: ["学生"], banned: true, createdAt: "2026-10-02T00:00:00Z" },
          ],
          total: 2, page: 1, pageSize: 20,
        }),
      });
    });
    const patchCalls: unknown[] = [];
    await page.route("**/api/admin/users/*", async (route: Route) => {
      if (route.request().method() !== "PATCH") {
        await route.fallback();
        return;
      }
      patchCalls.push(route.request().postDataJSON());
      const body = route.request().postDataJSON() as { banned: boolean };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ banned: body.banned }) });
    });

    await page.goto("/admin/users");
    const selfRow = page.getByTestId("用户行").first();
    const otherRow = page.getByTestId("用户行").nth(1);

    // 自己那一行：正常态 + 禁用按钮不可用并附提示
    const selfBanButton = selfRow.getByTestId("禁用启用按钮");
    await expect(selfBanButton).toBeDisabled();
    await expect(selfBanButton).toHaveAttribute("title", "不能禁用自己的账号");
    await selfBanButton.click({ force: true }).catch(() => undefined); // 禁用态点击不触发请求
    await page.waitForTimeout(150);
    expect(patchCalls).toHaveLength(0);
    await expect(selfRow.getByTestId("账号状态")).toContainText("正常"); // 状态未变

    // 已被禁用的他人行：按钮为「启用」且可用
    const otherButton = otherRow.getByTestId("禁用启用按钮");
    await expect(otherButton).toBeEnabled();
    await expect(otherButton).toHaveText("启用");
  });
});
