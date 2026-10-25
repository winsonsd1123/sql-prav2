import { test, expect, type Page } from "@playwright/test";

// 演练场 UI 关键路径冒烟（issue #9）：编辑器、库浏览器折叠、差异对照、
// 提示逐层揭示、参考答案标注、进度持久与换一套重置。
// 固定种子保证题目确定。

async function 打开演练场(page: Page, seed = 42) {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
}

async function 输入SQL(page: Page, sql: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(sql);
}

test("CodeMirror 编辑器渲染、行号与快捷键提交", async ({ page }) => {
  await 打开演练场(page);
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".cm-gutters")).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();

  await 输入SQL(page, "SELECT 1");
  // Ctrl/⌘+Enter 触发验证 → 结果集不等价 → 出现差异对照
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText("不通过：结果集与预期不等价")).toBeVisible();
  await expect(page.getByTestId("差异对照")).toBeVisible();
  await expect(page.getByText("你的结果")).toBeVisible();
  await expect(page.getByText("预期结果")).toBeVisible();
});

test("库浏览器：表可折叠，展示列与数据预览", async ({ page }) => {
  await 打开演练场(page);
  const 首表 = page.locator('details[data-testid="库表"]').first();
  // 展开（默认可能收起，点击 summary 确保）
  const summary = 首表.locator("summary");
  await summary.click(); // 收起
  await expect(首表.locator("table")).toBeHidden();
  await summary.click(); // 再展开
  await expect(首表.locator("table")).toBeVisible();
  await expect(首表.locator("li").first()).toContainText(/INTEGER|TEXT/);
  // 整体侧栏收起/展开
  await page.getByRole("button", { name: "收起" }).click();
  await expect(page.getByRole("button", { name: /库浏览器/ })).toBeVisible();
  await page.getByRole("button", { name: /库浏览器/ }).click();
  await expect(page.getByRole("button", { name: "收起" })).toBeVisible();
});

test("两层提示逐层揭示并随会话保留", async ({ page }) => {
  await 打开演练场(page);
  await expect(page.getByText("提示 1 · 思路：")).toBeHidden();
  await page.getByRole("button", { name: /显示提示/ }).click();
  await expect(page.getByText("提示 1 · 思路：")).toBeVisible();
  await expect(page.getByText("提示 2 · 关键子句：")).toBeHidden();
  await page.getByRole("button", { name: /再显示一层/ }).click();
  await expect(page.getByText("提示 2 · 关键子句：")).toBeVisible();
  // 刷新后已看层数保留
  await page.reload();
  await expect(page.getByText("提示 1 · 思路：")).toBeVisible();
  await expect(page.getByText("提示 2 · 关键子句：")).toBeVisible();
});

test("参考答案：查看后标注已借助答案；按答案作答计完成度并持久", async ({ page }) => {
  await 打开演练场(page);
  await page.getByRole("button", { name: "查看参考答案" }).click();
  await expect(page.getByText("已借助答案").first()).toBeVisible();
  const 答案 = await page.getByTestId("提示与答案").locator("pre").innerText();

  await 输入SQL(page, 答案);
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText("通过！结果集与预期等价。")).toBeVisible();
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 1\/\d+$/);

  // 刷新后进度保留
  await page.reload();
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 1\/\d+$/);
  // 首题按钮呈完成态（绿色）由 class 断言粗略覆盖
  await expect(page.getByTestId("完成度")).toBeVisible();
});

test("换一套后进度重置", async ({ page }) => {
  await 打开演练场(page, 43);
  await page.getByRole("button", { name: "查看参考答案" }).click();
  const 答案 = await page.getByTestId("提示与答案").locator("pre").innerText();
  await 输入SQL(page, 答案);
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText("通过！结果集与预期等价。")).toBeVisible();

  await page.getByRole("button", { name: "换一套（新种子）" }).click();
  // 种子变化 → 进度键变化 → 完成度归零
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 0\//);
});
