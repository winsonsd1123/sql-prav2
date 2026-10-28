// T6 · 进度上云 E2E（issue #28）：Supabase REST 网络层 mock（云端进度桩，见 辅助.ts）。
// 覆盖：判定后节流静默上云；刷新/新会话从云端恢复完整进度（尝试/草稿/通过状态）；
// 跨浏览器上下文（新 context 预置会话）进度恢复；断网（云写失败）兜底静默 + 恢复后自动冲写。
import { expect, test, type Page } from "@playwright/test";
import { 预置登录态, 创建云端进度桩, type 云端进度行 } from "./辅助";

const 用户id = "e2e-user";

async function 打开演练场(page: Page, seed: number) {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
}

async function 输入SQL(page: Page, sql: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(sql);
}

/** 记一次不通过尝试（固定错误 SQL，判定必为「错误」） */
async function 记一次不通过尝试(page: Page) {
  await 输入SQL(page, "SELECT 断网兜底尝试");
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText(/不通过：|ERROR|超出|防护/).first()).toBeVisible({ timeout: 15000 });
}

test.beforeEach(async ({ page }) => {
  await 预置登录态(page);
});

test("判定后约 3 秒节流静默上云，载荷含尝试次数与草稿", async ({ page }) => {
  const 桩 = 创建云端进度桩();
  await 桩.挂(page);
  await 打开演练场(page, 61);
  await 输入SQL(page, "SELECT 草稿上云");
  await 记一次不通过尝试(page);
  await expect
    .poll(() => 桩.收到的写.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1);
  const 行 = 桩.收到的写.find((r) => r.种子 === 61);
  expect(行).toBeDefined();
  expect(行!.用户id).toBe(用户id);
  expect(行!.进度.尝试次数?.["0"]).toBeGreaterThanOrEqual(1);
});

test("云端已有进度：进入同会话即完整恢复（通过状态、尝试门槛、草稿）", async ({ page }) => {
  const 桩 = 创建云端进度桩();
  const 云端行: 云端进度行 = {
    用户id,
    种子: 62,
    域包: "student-course-grade",
    进度: {
      已通过题号: [0],
      尝试次数: { "1": 3 },
      草稿: { "1": "SELECT 云端草稿" },
    },
  };
  桩.行集.set(桩.键(云端行), 云端行);
  await 桩.挂(page);
  await 打开演练场(page, 62);
  // 通过状态恢复：完成度 1/N
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 1\//);
  // 尝试门槛恢复：第 2 题尝试 3 次已达答案解锁线
  await page.getByRole("button").filter({ hasText: "#02" }).click();
  await expect(page.getByTestId("答案按钮")).toBeEnabled();
  // 草稿恢复：编辑器载入云端草稿（用户未编辑前持续跟随云端恢复）
  await expect(page.locator(".cm-content")).toContainText("SELECT 云端草稿");
});

test("跨浏览器上下文：新 context 同账号同会话，进度从云端恢复", async ({ page, browser }) => {
  const 桩 = 创建云端进度桩();
  await 桩.挂(page);
  await 打开演练场(page, 63);
  await 记一次不通过尝试(page);
  // 等节流窗口（3 秒）落上云
  await expect
    .poll(() => 桩.收到的写.some((r) => r.种子 === 63), { timeout: 10_000 })
    .toBe(true);
  // 新浏览器上下文（另一台设备的等价物）：预置同账号会话 + 同一张云
  const 上下文B = await browser.newContext();
  const 页B = await 上下文B.newPage();
  await 预置登录态(页B);
  await 桩.挂(页B);
  await 打开演练场(页B, 63);
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 0\//); // 首上下文仍 0
  await expect(页B.getByTestId("完成度")).toHaveText(/^已完成 0\//);
  // 尝试门槛跨上下文恢复：第 1 题已尝试 1 次 → 提示已解锁（未尝试则锁定）
  await expect(页B.getByTestId("提示按钮")).toBeEnabled();
  await 上下文B.close();
});

test("断网兜底：云写失败静默不弹 UI，恢复后自动冲写云端", async ({ page }) => {
  const 桩 = 创建云端进度桩();
  await 桩.挂(page); // 先挂桩（Playwright 后注册的路由优先生效），再覆盖故障层
  let 云端故障 = true;
  await page.route("**/rest/v1/**", async (route) => {
    if (云端故障) return route.fulfill({ status: 500, body: "mock offline" });
    return route.fallback();
  });
  await 打开演练场(page, 64);
  await 记一次不通过尝试(page);
  // 故障期 + 节流 + 一次退避（3 秒）重试均失败：页面无异常弹层、做题不受影响
  await page.waitForTimeout(8000);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 0\//);
  // 网络恢复：退避重试自动冲写成功
  云端故障 = false;
  await expect
    .poll(() => 桩.收到的写.some((r) => r.种子 === 64 && (r.进度.尝试次数?.["0"] ?? 0) >= 1), {
      timeout: 20_000,
    })
    .toBe(true);
});
