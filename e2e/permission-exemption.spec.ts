import { test, expect, type Page } from "@playwright/test";
import { presetLoginState } from "./helpers";

// T5 · 权限点判定与参考答案豁免（issue #27，ADR-0003 修订 v3 / ADR-0005）：
// 学生（无权限点）走摩擦力门槛；持「随时查看参考答案」（mock 教师权限）免门槛直接可见，
// 且不弹确认框、不挂「已借助答案」徽章、不写入进度。

test.beforeEach(async ({ page }) => {
  await presetLoginState(page);
});

async function openPlayground(page: Page, seed = 42) {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
}

/** mock 当前用户（e2e-user）的教师权限：user_roles → role_permissions 两跳均以 REST 拦截（表名英文，glob 直配） */
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
        { role: "教师", permission: "随时查看参考答案", created_at: "2026-01-01" },
      ]),
    });
  });
}

test("学生（无权限点，查询失败回退空集合）仍走摩擦力门槛", async ({ page }) => {
  // 权限表不可达（真实环境表未建时的安全默认）：拦截并断连，回退空集合 = 学生行为
  await page.route("**/rest/v1/**", (route) => route.abort());
  await openPlayground(page);
  await expect(page.getByTestId("答案锁定说明")).toHaveText(/再试 3 次或看提示后解锁答案/);
  await expect(page.getByRole("button", { name: "查看参考答案" })).toBeDisabled();
  await expect(page.getByTestId("答案豁免说明")).toBeHidden();
});

test("教师（mock「随时查看参考答案」）0 尝试即直接可见答案，无确认框、无徽章、不写入进度", async ({ page }) => {
  await mockTeacherPermissions(page);
  await openPlayground(page);
  // 免门槛：无锁定说明，按钮可用，豁免说明出现
  await expect(page.getByTestId("答案锁定说明")).toBeHidden();
  await expect(page.getByRole("button", { name: "查看参考答案" })).toBeEnabled();
  await expect(page.getByTestId("答案豁免说明")).toBeVisible();
  // 直接查看：不弹确认框
  await page.getByRole("button", { name: "查看参考答案" }).click();
  await expect(page.getByTestId("答案确认框")).toBeHidden();
  const answer = await page.getByTestId("提示与答案").locator("pre").innerText();

  // 教学检视不记「借助答案」：无徽章，进度不写入已借助答案题号
  await expect(page.getByText("已借助答案", { exact: true }).first()).toBeHidden();
  const rawProgress = await page.evaluate(() =>
    localStorage.getItem("sql-playground:progress:student-course-grade:42"),
  );
  // 纯查看不触发进度写入；即便已有进度记录，也已借助答案题号为空（查看后一行还会自行通过验证）
  const aidedAnswers = rawProgress ? JSON.parse(rawProgress).已借助答案题号 : [];
  expect(aidedAnswers).toEqual([]);

  // 教师看答案后自行通过 → 语义仍是独立完成（豁免不吞分档）
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(answer);
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText("通过！结果集与预期等价。")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("已借助答案", { exact: true }).first()).toBeHidden();
});
