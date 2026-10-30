// T6 · 进度上云 E2E（issue #28）：Supabase REST 网络层 mock（云端进度桩，见 helpers.ts）。
// 覆盖：判定后节流静默上云；刷新/新会话从云端恢复完整进度（尝试/草稿/通过状态）；
// 跨浏览器上下文（新 context 预置登录态）进度恢复；断网（云写失败）兜底静默 + 恢复后自动冲写。
import { expect, test, type Page } from "@playwright/test";
import { presetLoginState, createCloudProgressStub, type CloudProgressRow } from "./helpers";

const USER_ID = "e2e-user";

async function openPlayground(page: Page, seed: number) {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
}

async function typeSql(page: Page, sql: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(sql);
}

/** 记一次不通过尝试（固定错误 SQL，判定必为「错误」） */
async function recordFailedAttempt(page: Page) {
  await typeSql(page, "SELECT 断网兜底尝试");
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText(/不通过：|ERROR|超出|防护/).first()).toBeVisible({ timeout: 15000 });
}

test.beforeEach(async ({ page }) => {
  await presetLoginState(page);
});

test("判定后约 3 秒节流静默上云，载荷含尝试次数与草稿", async ({ page }) => {
  const stub = createCloudProgressStub();
  await stub.attach(page);
  await openPlayground(page, 61);
  await typeSql(page, "SELECT 草稿上云");
  await recordFailedAttempt(page);
  await expect
    .poll(() => stub.receivedWrites.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1);
  const row = stub.receivedWrites.find((r) => r.seed === 61);
  expect(row).toBeDefined();
  expect(row!.user_id).toBe(USER_ID);
  expect(row!.progress.attemptCounts?.["0"]).toBeGreaterThanOrEqual(1);
});

test("云端已有进度：进入同会话即完整恢复（通过状态、尝试门槛、草稿）", async ({ page }) => {
  const stub = createCloudProgressStub();
  const cloudRow: CloudProgressRow = {
    user_id: USER_ID,
    seed: 62,
    pack_id: "student-course-grade",
    progress: {
      passedIndices: [0],
      attemptCounts: { "1": 3 },
      drafts: { "1": "SELECT 云端草稿" },
    },
  };
  stub.rows.set(stub.rowKey(cloudRow), cloudRow);
  await stub.attach(page);
  await openPlayground(page, 62);
  // 通过状态恢复：完成度 1/N
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 1\//);
  // 尝试门槛恢复：第 2 题尝试 3 次已达答案解锁线
  await page.getByRole("button").filter({ hasText: "#02" }).click();
  await expect(page.getByTestId("答案按钮")).toBeEnabled();
  // 草稿恢复：编辑器载入云端草稿（用户未编辑前持续跟随云端恢复）
  await expect(page.locator(".cm-content")).toContainText("SELECT 云端草稿");
});

test("跨浏览器上下文：新 context 同用户同会话，进度从云端恢复", async ({ page, browser }) => {
  const stub = createCloudProgressStub();
  await stub.attach(page);
  await openPlayground(page, 63);
  await recordFailedAttempt(page);
  // 等节流窗口（3 秒）落上云
  await expect
    .poll(() => stub.receivedWrites.some((r) => r.seed === 63), { timeout: 10_000 })
    .toBe(true);
  // 新浏览器上下文（另一台设备的等价物）：预置同用户登录态 + 同一张云
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await presetLoginState(pageB);
  await stub.attach(pageB);
  await openPlayground(pageB, 63);
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 0\//); // 首上下文仍 0
  await expect(pageB.getByTestId("完成度")).toHaveText(/^已完成 0\//);
  // 尝试门槛跨上下文恢复：第 1 题已尝试 1 次 → 提示已解锁（未尝试则锁定）
  await expect(pageB.getByTestId("提示按钮")).toBeEnabled();
  await contextB.close();
});

test("断网兜底：云写失败静默不弹 UI，恢复后自动冲写云端", async ({ page }) => {
  const stub = createCloudProgressStub();
  await stub.attach(page); // 先挂桩（Playwright 后注册的路由优先生效），再覆盖故障层
  let cloudDown = true;
  await page.route("**/rest/v1/**", async (route) => {
    if (cloudDown) return route.fulfill({ status: 500, body: "mock offline" });
    return route.fallback();
  });
  await openPlayground(page, 64);
  await recordFailedAttempt(page);
  // 故障期 + 节流 + 一次退避（3 秒）重试均失败：页面无异常弹层、做题不受影响
  await page.waitForTimeout(8000);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 0\//);
  // 网络恢复：退避重试自动冲写成功
  cloudDown = false;
  await expect
    .poll(() => stub.receivedWrites.some((r) => r.seed === 64 && (r.progress.attemptCounts?.["0"] ?? 0) >= 1), {
      timeout: 20_000,
    })
    .toBe(true);
});
