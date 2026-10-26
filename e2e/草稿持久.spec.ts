import { test, expect, type Page } from "@playwright/test";

// SQL 草稿按题保留与持久化（issue #15）：
// 切题恢复、刷新保留、换一套/换域包随会话重置三场景。
// 固定种子保证题目与进度键确定；每测例独立 context，localStorage 互不串扰。

async function 打开演练场(page: Page, seed = 52) {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
}

async function 编辑器文本(page: Page): Promise<string> {
  return page.locator(".cm-content").innerText();
}

async function 输入SQL(page: Page, sql: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(sql);
}

test("切题再返回，该题草稿恢复且其他题不受污染", async ({ page }) => {
  await 打开演练场(page);
  await 输入SQL(page, "SELECT 草稿一");
  // 切到第 2 题：编辑器应为空（该题无草稿）
  await page.getByRole("button").filter({ hasText: "#02" }).click();
  await expect(await 编辑器文本(page)).toBe("在此输入单条 SELECT 语句……\n");
  await 输入SQL(page, "SELECT 草稿二");
  // 回到第 1 题：草稿一恢复；再去第 2 题：草稿二恢复
  await page.getByRole("button").filter({ hasText: "#01" }).click();
  await expect(await 编辑器文本(page)).toContain("SELECT 草稿一");
  await page.getByRole("button").filter({ hasText: "#02" }).click();
  await expect(await 编辑器文本(page)).toContain("SELECT 草稿二");
});

test("刷新页面后草稿仍在", async ({ page }) => {
  await 打开演练场(page);
  await 输入SQL(page, "SELECT 刷新不丢");
  // 等防抖窗口（500ms）落盘后再刷新
  await page.waitForTimeout(900);
  await page.reload();
  await expect(await 编辑器文本(page)).toContain("SELECT 刷新不丢");
});

test("换一套后草稿随会话重置", async ({ page }) => {
  await 打开演练场(page, 53);
  await 输入SQL(page, "SELECT 换套前草稿");
  await page.getByRole("button", { name: "换一套（新种子）" }).click();
  await expect(page.getByTestId("完成度")).toHaveText(/^已完成 0\//);
  await expect(await 编辑器文本(page)).toBe("在此输入单条 SELECT 语句……\n");
});

test("换域包后草稿随会话重置", async ({ page }) => {
  await 打开演练场(page, 54);
  await 输入SQL(page, "SELECT 换包前草稿");
  const 目标域包 = page.getByRole("button", { name: "员工-部门-薪资" });
  if ((await 目标域包.getAttribute("class"))?.includes("blue-600")) return; // 已是该域包则跳过
  await 目标域包.click();
  await expect(await 编辑器文本(page)).toBe("在此输入单条 SELECT 语句……\n");
});
