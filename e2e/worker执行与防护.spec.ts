import { test, expect, type Page } from "@playwright/test";

// Worker 执行路径与大查询防护（issue #10 / T10 验收）：
// 1. 验证按钮在 Worker 模式下工作（建库+查询+比对全部在 Worker 内）；
// 2. 首次 WASM 加载指示可见且会就绪；
// 3. 结果行数上限触发产品提示（非伪造 MySQL 错误）；
// 4. 执行超时触发产品提示、期间 UI 可交互、超时后 Worker 重建可继续判题。
// 超时上限可用 URL 参数 timeoutMs 缩短（worker客户端.ts 的 e2e 调试通道），
// 慢查询用六重自笛卡尔积 COUNT（结果仅 1 行，绕开行数上限，纯耗时）。

async function 打开演练场(page: Page, seed = 42, 额外参数 = "") {
  await page.goto(`/?seed=${seed}${额外参数}`);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
}

async function 输入SQL(page: Page, sql: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(sql);
}

async function 取表名(page: Page): Promise<string> {
  // 实例表名随种子随机化，从库浏览器读实际名（域包A固定 3 表，第 1 表 20 行）
  return page.locator('[data-testid="库表"]').first().getAttribute("data-表名") as Promise<string>;
}

test("验证按钮走 Worker 路径：通过与不通过均正常返回", async ({ page }) => {
  await 打开演练场(page);
  // 不通过 → 差异对照（学生 SQL 与参考答案均在 Worker 内执行后比对）
  await 输入SQL(page, "SELECT 1");
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText("不通过：结果集与预期不等价")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("差异对照")).toBeVisible();
  // 答案两级解锁（issue #16）：再累计两次不通过尝试后解锁，确认查看
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await page.getByRole("button", { name: "查看参考答案" }).click();
  await page.getByTestId("确认查看答案").click();
  const 答案 = await page.getByTestId("提示与答案").locator("pre").innerText();
  await 输入SQL(page, 答案);
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText("通过！结果集与预期等价。")).toBeVisible({ timeout: 10_000 });
});

test("首次加载 WASM 有加载指示，随后就绪", async ({ page }) => {
  // 拦截 wasm 请求放慢 500ms，保证加载指示可被观测（fresh context 无缓存）
  await page.route("**/sql-wasm.wasm", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.continue();
  });
  await 打开演练场(page);
  // Worker 在首次验证时懒创建，指示随之出现
  await 输入SQL(page, "SELECT 1");
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByTestId("引擎加载中")).toBeVisible();
  // 引擎就绪后指示消失，判题正常返回
  await expect(page.getByTestId("引擎加载中")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText("不通过：结果集与预期不等价")).toBeVisible({ timeout: 10_000 });
});

test("结果行数上限：三表笛卡尔积触发产品提示", async ({ page }) => {
  await 打开演练场(page);
  const 全部表名 = await page.locator('[data-testid="库表"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-表名") as string),
  );
  // 域包A：20 × 15 × 45 = 13500 行 > 10000 上限
  await 输入SQL(page, `SELECT * FROM ${全部表名.join(", ")}`);
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText(/查询结果超过 10000 行上限，已停止执行/)).toBeVisible({ timeout: 15_000 });
  // 产品提示而非 MySQL 错误：不应出现 mysql> 终端块
  await expect(page.getByText("mysql&gt;")).toBeHidden();
});

test("执行超时：产品提示、期间 UI 可交互、Worker 重建后可继续判题", async ({ page }) => {
  await 打开演练场(page, 42, "&timeoutMs=300");
  const 表名 = await 取表名(page);
  // 六重自笛卡尔积 COUNT（20^6 次组合，结果 1 行，纯耗时）必然超过 300ms
  await 输入SQL(page, `SELECT COUNT(*) FROM ${表名} a, ${表名} b, ${表名} c, ${表名} d, ${表名} e, ${表名} f`);
  await page.getByRole("button", { name: "验证", exact: true }).click();
  // 判定期间 UI 保持可交互：库浏览器收起按钮立即可点
  await expect(page.getByRole("button", { name: "收起" })).toBeEnabled();
  await page.getByRole("button", { name: "收起" }).click();
  // 超时提示（产品文案，非 MySQL 错误）
  await expect(page.getByText(/秒上限，已自动终止/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("mysql&gt;")).toBeHidden();
  // Worker 被终止后自动重建：普通查询可继续判题
  await page.getByRole("button", { name: /库浏览器/ }).click();
  await 输入SQL(page, "SELECT 1");
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText("不通过：结果集与预期不等价")).toBeVisible({ timeout: 15_000 });
});
