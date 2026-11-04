import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, stubPlaygroundBackend } from "./helpers";

// #106 · 侧栏品牌区升级：SVG logo（等距数据库几何风格，配色走 sidebar token）+ 标题横排、
// 字号收敛 text-lg、删除「Admin Console」副标；favicon 以 app icon（icon.svg）同图替换。
// 断言口径：bounding box 视觉事实 + aria 属性，不断言 class 名；
// 红线：h1「后台管理」heading 语义保留（admin-console.spec 的既有锚点不受影响）。

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
    await stubPlaygroundBackend(page);
  });

  /** 与 admin-console.spec 同口径：管理员权限两跳 + 后台页面 API 空态桩 */
  async function mockAdmin(page: Page) {
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
    await page.route("**/api/admin/users*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ users: [], total: 0, page: 1, pageSize: 20 }),
      });
    });
  }

  test("品牌区：SVG logo 与标题「后台管理」横排，副标「Admin Console」已删除", async ({ page }) => {
    await mockAdmin(page);
    await page.goto("/admin/users");
    await expect(page.getByTestId("用户列表")).toBeVisible();

    // 标题 heading 语义保留
    const heading = page.getByRole("heading", { name: "后台管理", exact: true });
    await expect(heading).toBeVisible();

    // logo 以 img 角色暴露（aria-label），且与标题横排：logo 在左、与标题纵向重叠、尺寸合理
    const logo = page.getByRole("img", { name: "后台 logo" });
    await expect(logo).toBeVisible();
    const logoBox = await logo.boundingBox();
    const headingBox = await heading.boundingBox();
    if (!logoBox || !headingBox) throw new Error("品牌区元素未渲染出 bounding box");
    expect(logoBox.x).toBeLessThan(headingBox.x);
    expect(logoBox.y).toBeLessThan(headingBox.y + headingBox.height);
    expect(logoBox.width).toBeGreaterThan(15);
    expect(logoBox.height).toBeGreaterThan(15);

    // 英文副标删除
    await expect(page.getByText("Admin Console")).toHaveCount(0);
  });

  test("favicon：app icon 以同图 SVG 提供且被页面引用", async ({ page }) => {
    await mockAdmin(page);
    await page.goto("/admin/users");
    await expect(page.getByTestId("用户列表")).toBeVisible();

    // <head> 引用 icon（Next app icon 约定输出 link rel=icon）
    const iconHref = await page.evaluate(() => {
      const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      return link?.href ?? null;
    });
    expect(iconHref, "页面 head 应引用 favicon").not.toBeNull();

    // 该 href 实际可取且为 SVG 同图
    const res = await page.request.get(iconHref!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("svg");
    const body = await res.text();
    expect(body).toContain("<svg");
  });
});
