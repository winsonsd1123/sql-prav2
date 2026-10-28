import { test, expect, type Page } from "@playwright/test";
import { 预置登录态 } from "./辅助";

test.beforeEach(async ({ page }) => {
  await 预置登录态(page);
});

// 编辑器禁粘贴与拖入（issue #17，T6）：粘贴/拖入无效果、
// 拦截横幅出现与约 2 秒消失、同会话不重复弹、补全保留、展示区可复制。
// 粘贴模拟：构造带 clipboardData 的 ClipboardEvent 派发到 .cm-content，
// 与键盘 Cmd/Ctrl+V 触发的 paste 事件走同一条 CodeMirror domEventHandlers 通路。

const 禁粘横幅文本 = "请手动输入 SQL，粘贴已禁用";

async function 打开演练场(page: Page, seed = 42) {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  await page.locator(".cm-content").click();
}

/** 向编辑器派发一个带文本的 paste 事件（模拟键盘/右键粘贴触发的事件） */
async function 模拟粘贴(page: Page, 文本: string) {
  await page.evaluate(
    ([t]) => {
      const 内容 = document.querySelector(".cm-content");
      if (!内容) throw new Error("编辑器内容区不存在");
      const 数据 = new DataTransfer();
      数据.setData("text/plain", t as string);
      内容.dispatchEvent(new ClipboardEvent("paste", { clipboardData: 数据, bubbles: true, cancelable: true }));
    },
    [文本],
  );
}

/** 向编辑器派发一个带文本的 drop 事件（模拟拖入文本） */
async function 模拟拖入(page: Page, 文本: string) {
  await page.evaluate(
    ([t]) => {
      const 内容 = document.querySelector(".cm-content");
      if (!内容) throw new Error("编辑器内容区不存在");
      const 数据 = new DataTransfer();
      数据.setData("text/plain", t as string);
      内容.dispatchEvent(new DragEvent("drop", { dataTransfer: 数据, bubbles: true, cancelable: true }));
    },
    [文本],
  );
}

async function 编辑器文本(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
}

test("键盘粘贴（真实 Cmd/Ctrl+V）被拦截且出现横幅", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "webkit 剪贴板权限不可用，剪贴板路径由派发事件测试覆盖");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await 打开演练场(page);
  await page.evaluate(() => navigator.clipboard.writeText("SELECT 粘贴内容"));
  await page.keyboard.press("ControlOrMeta+v");
  await expect(编辑器文本(page)).resolves.not.toContain("粘贴内容");
  await expect(page.getByText(禁粘横幅文本)).toBeVisible();
});

test("派发 paste 事件无效果且出现横幅，约 2 秒后横幅消失", async ({ page }) => {
  await 打开演练场(page);
  await 模拟粘贴(page, "SELECT * FROM 学生");
  await expect(编辑器文本(page)).resolves.not.toContain("学生");
  await expect(page.getByText(禁粘横幅文本)).toBeVisible();
  // 横幅保留一段时间后自动消失（2 秒量级，放宽窗口避免慢机抖动）
  await page.waitForTimeout(3500);
  await expect(page.getByText(禁粘横幅文本)).toBeHidden();
});

test("拖入文本无效果且出现横幅", async ({ page }) => {
  await 打开演练场(page);
  await 模拟拖入(page, "SELECT * FROM 课程");
  await expect(编辑器文本(page)).resolves.not.toContain("课程");
  await expect(page.getByText(禁粘横幅文本)).toBeVisible();
});

test("同一会话内连续触发不重复弹横幅", async ({ page }) => {
  await 打开演练场(page);
  await 模拟粘贴(page, "SELECT 1");
  await expect(page.getByText(禁粘横幅文本)).toBeVisible();
  await page.waitForTimeout(3500); // 等首次横幅消失
  await expect(page.getByText(禁粘横幅文本)).toBeHidden();
  await 模拟粘贴(page, "SELECT 2");
  await 模拟拖入(page, "SELECT 3");
  await page.waitForTimeout(300);
  await expect(page.getByText(禁粘横幅文本)).toBeHidden();
});

test("表名自动补全仍可用", async ({ page }) => {
  await 打开演练场(page);
  await page.keyboard.type("S");
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
});

test("提示与答案展示区不禁复制", async ({ page }) => {
  await 打开演练场(page);
  // T5 两级解锁（#16）后答案按钮需尝试门槛：预置 3 次尝试解锁参考答案
  await page.evaluate(() => {
    localStorage.setItem(
      "sql-playground:progress:student-course-grade:42",
      JSON.stringify({ 已通过题号: [], 已看提示: {}, 已借助答案题号: [], 尝试次数: { "0": 3 } }),
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "查看参考答案" }).click();
  await page.getByTestId("确认查看答案").click();
  const 可复制 = await page.getByTestId("提示与答案").locator("pre").evaluate((el) => {
    // user-select 未被禁用即可选中复制（工单：展示区不禁复制）
    return getComputedStyle(el).userSelect !== "none";
  });
  expect(可复制).toBe(true);
});
