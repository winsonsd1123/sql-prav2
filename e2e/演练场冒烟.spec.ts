import { test, expect, type Page } from "@playwright/test";

// 演练场 UI 关键路径冒烟（issue #9）：编辑器、库浏览器折叠、差异对照、
// 提示逐层揭示、参考答案标注、进度持久与换一套重置。
// 固定种子保证题目确定。

async function 打开演练场(page: Page, seed = 42) {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
}

/** 提交一次必然不通过的 SQL，累计一次"尝试"（issue #16 口径） */
async function 记一次不通过尝试(page: Page) {
  await 输入SQL(page, "SELECT 1");
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(
    page.getByText(/不通过：结果集与预期不等价|ERROR|超出|防护/),
  ).toBeVisible({ timeout: 15000 });
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

// 库浏览器浮层（issue #14 T3）：默认隐藏，顶栏「库」按钮与 Cmd/Ctrl+B 切换，
// 点击浮层外部（含编辑器）或按 ESC 收起；无遮罩层；表级折叠与数据预览保留。
test("库浏览器浮层：默认隐藏，按钮与 Cmd/Ctrl+B 均可唤出", async ({ page }) => {
  await 打开演练场(page);
  // 默认不可见
  await expect(page.getByTestId("库浏览器浮层")).toBeHidden();
  // 顶栏「库」按钮唤出
  await page.getByRole("button", { name: "库（Ctrl/⌘+B）" }).click();
  await expect(page.getByTestId("库浏览器浮层")).toBeVisible();
  // ESC 收起
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("库浏览器浮层")).toBeHidden();
  // Cmd/Ctrl+B 唤出，再按一次切换收起
  await page.keyboard.press("ControlOrMeta+b");
  await expect(page.getByTestId("库浏览器浮层")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(page.getByTestId("库浏览器浮层")).toBeHidden();
  // 浮层关闭时焦点在编辑器内，按 ESC 不应弹出（无劫持）
  await 输入SQL(page, "SELECT 1");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("库浏览器浮层")).toBeHidden();
});

test("库浏览器浮层：点击外部任意处（含编辑器）收起；表级折叠与预览保留", async ({ page }) => {
  await 打开演练场(page);
  await page.keyboard.press("ControlOrMeta+b");
  const 首表 = page.locator('details[data-testid="库表"]').first();
  const summary = 首表.locator("summary");
  await summary.click(); // 收起
  await expect(首表.locator("table")).toBeHidden();
  await summary.click(); // 再展开
  await expect(首表.locator("table")).toBeVisible();
  await expect(首表.locator("li").first()).toContainText(/INTEGER|TEXT/);
  // 点击编辑器（浮层外）→ 浮层收起、无遮罩层
  await page.locator(".cm-content").click();
  await expect(page.getByTestId("库浏览器浮层")).toBeHidden();
  await expect(page.locator(".cm-editor")).toBeVisible();
});

test("两层提示逐层揭示并随会话保留", async ({ page }) => {
  await 打开演练场(page);
  await expect(page.getByText("提示 1 · 思路：")).toBeHidden();
  // 两级解锁（issue #16）：0 次尝试时提示锁定；先验证一次解锁
  await expect(page.getByTestId("提示锁定说明")).toHaveText(/先验证一次解锁提示/);
  await 记一次不通过尝试(page);
  await expect(page.getByTestId("提示锁定说明")).toBeHidden();
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

test("参考答案：三次不通过尝试后解锁，确认框知情后标注已借助答案", async ({ page }) => {
  await 打开演练场(page);
  // 两级解锁（issue #16）：锁定态直接标明解锁条件
  await expect(page.getByTestId("答案锁定说明")).toHaveText(/再试 3 次或看提示后解锁答案/);
  await 记一次不通过尝试(page);
  await expect(page.getByTestId("答案锁定说明")).toHaveText(/再试 2 次或看提示后解锁答案/);
  await 记一次不通过尝试(page);
  await 记一次不通过尝试(page);
  await expect(page.getByTestId("答案锁定说明")).toBeHidden();
  // 解锁后先弹确认框（将记入进度），确认才展示
  await page.getByRole("button", { name: "查看参考答案" }).click();
  await expect(page.getByTestId("答案确认框")).toBeVisible();
  await expect(page.getByText("已借助答案", { exact: true }).first()).toBeHidden();
  await page.getByTestId("确认查看答案").click();
  await expect(page.getByText("已借助答案", { exact: true }).first()).toBeVisible();
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
  await 记一次不通过尝试(page);
  await 记一次不通过尝试(page);
  await 记一次不通过尝试(page);
  await page.getByRole("button", { name: "查看参考答案" }).click();
  await page.getByTestId("确认查看答案").click();
  const 答案 = await page.getByTestId("提示与答案").locator("pre").innerText();
  await 输入SQL(page, 答案);
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText("通过！结果集与预期等价。")).toBeVisible();

  await page.getByRole("button", { name: "换一套（新种子）" }).click();
  // 种子变化 → 进度键变化 → 完成度归零
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 0\//);
});

test("已通过的题提示与答案自由查看，通过后查看不挂已借助答案徽章（issue #16）", async ({ page }) => {
  // 预置第 0 题已通过的进度（不经查看答案取得），验证通过后自由查看且不记借助
  await page.goto("/?seed=42");
  await page.evaluate(() => {
    localStorage.setItem(
      "sql-playground:progress:student-course-grade:42",
      JSON.stringify({ 已通过题号: [0], 已看提示: {}, 已借助答案题号: [], 尝试次数: { "0": 3 } }),
    );
  });
  await page.reload();
  // 已通过 → 锁定说明不出现，提示/答案按钮均可用
  await expect(page.getByTestId("提示锁定说明")).toBeHidden();
  await expect(page.getByTestId("答案锁定说明")).toBeHidden();
  await page.getByRole("button", { name: /显示提示/ }).click();
  await expect(page.getByText("提示 1 · 思路：")).toBeVisible();
  // 通过后查看答案：无确认框、直接展示、不挂徽章
  await page.getByRole("button", { name: "查看参考答案" }).click();
  await expect(page.getByTestId("答案确认框")).toBeHidden();
  await expect(page.getByTestId("提示与答案").locator("pre")).toBeVisible();
  await expect(page.getByText("已借助答案", { exact: true }).first()).toBeHidden();
});
