import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, expectConsoleClean, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";

// 导航展示质感 spec（票 #105 / spec #104）：菜单项图标、选中态视觉升级（背景高亮 +
// 主色文字 + 左侧 2px 圆角指示条）、分组标题字号归一 text-xs（12px 标准档）。
// 断言口径与 admin-nav-structure.spec 一致：bounding box / computed style 等
// 视觉事实 + aria 属性，不断言 class 名。选中态语义（aria-current 唯一）归
// admin-nav-structure.spec 持有，本 spec 只看「展示」这一个接缝。

let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
});
test.afterEach(() => {
  expectConsoleClean(consoleProblems);
});

/** mock 教师权限（访问后台 + 域包管理）并挂列表页依赖的离线桩（口径同 admin-nav-structure.spec） */
async function mockAdminEnv(page: Page) {
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
        { role: "教师", permission: "访问后台", created_at: "2026-01-01" },
        { role: "教师", permission: "域包管理", created_at: "2026-01-01" },
      ]),
    });
  });
  await createDomainPackAssetStub().attach(page);
  await createDomainPackVersionHistoryStub().attach(page);
  await page.route("**/api/admin/pack-exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });
  await page.route("**/api/admin/domain-packs/practice-config*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        packs: [
          {
            packId: "student-course-grade",
            name: "学生-课程-成绩",
            practiceConfig: { totalQuestions: 10, tierDistribution: { "1": 1, "2": 3, "3": 3, "4": 2, "5": 1 } },
            tierTemplateCounts: { "1": 3, "2": 12, "3": 10, "4": 7, "5": 2 },
          },
        ],
      }),
    });
  });
  await page.route("**/api/admin/domain-packs/versions*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ versions: [] }) });
  });
}

const ALL_LINK_LABELS = ["用户管理", "邮箱白名单", "域包列表", "版本历史", "放出管理", "演练配置", "知识点词表"] as const;

test("展开态七个菜单项均带图标，图标与文字同行对齐", async ({ page }) => {
  await mockAdminEnv(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/admin/packs");
  await expect(page.getByTestId("域包行-学生-课程-成绩")).toBeVisible();
  const nav = page.getByTestId("后台侧边导航");

  for (const label of ALL_LINK_LABELS) {
    const link = nav.getByRole("link", { name: label, exact: true });
    // 每个菜单项内恰有一个 svg 图标，且对屏幕阅读器隐藏（不污染可访问名）
    const icon = link.locator("svg[aria-hidden='true']");
    await expect(icon).toHaveCount(1);
    const linkBox = await link.boundingBox();
    const iconBox = await icon.boundingBox();
    if (!linkBox || !iconBox) throw new Error(`${label} 缺少 bounding box`);
    // 图标落在链接盒内、贴左（文字之前），并与文字行垂直居中对齐
    expect(iconBox.x, `${label} 图标应在链接盒内`).toBeGreaterThanOrEqual(linkBox.x);
    expect(iconBox.x + iconBox.width, `${label} 图标应在文字之前`).toBeLessThanOrEqual(linkBox.x + linkBox.width / 2);
    const linkCenterY = linkBox.y + linkBox.height / 2;
    const iconCenterY = iconBox.y + iconBox.height / 2;
    expect(Math.abs(iconCenterY - linkCenterY), `${label} 图标应垂直居中`).toBeLessThanOrEqual(2);
  }
});

test("选中项视觉升级：背景高亮 + 主色文字 + 左侧 2px 圆角指示条", async ({ page }) => {
  await mockAdminEnv(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/admin/packs");
  await expect(page.getByTestId("域包行-学生-课程-成绩")).toBeVisible();
  const nav = page.getByTestId("后台侧边导航");

  const active = nav.getByRole("link", { name: "域包列表", exact: true });
  const idle = nav.getByRole("link", { name: "版本历史", exact: true });
  await expect(active).toHaveAttribute("aria-current", "page");

  // 背景高亮：选中项的背景色不透明度高于未选中项（半透明主色底 vs 透明底）
  const activeBg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
  const idleBg = await idle.evaluate((el) => getComputedStyle(el).backgroundColor);
  const alpha = (color: string) => {
    const m = color.match(/rgba?\([^)]*,\s*([\d.]+)\)/);
    return m ? Number(m[1]) : 1;
  };
  expect(alpha(activeBg), `选中背景应高亮（${activeBg}）而非透明（${idleBg}）`).toBeGreaterThan(alpha(idleBg));

  // 主色文字：选中项文字色与未选中项不同且非默认侧栏文字色
  const activeColor = await active.evaluate((el) => getComputedStyle(el).color);
  const idleColor = await idle.evaluate((el) => getComputedStyle(el).color);
  expect(activeColor).not.toBe(idleColor);

  // 左侧指示条：选中项内存在一个宽 2px 的圆角元素，贴链接左缘、垂直居中
  // （图标是 svg[aria-hidden]，指示条用 span[aria-hidden] 落地，二者不冲突）
  const bar = active.locator("span[aria-hidden='true']");
  await expect(bar).toHaveCount(1);
  const barBox = await bar.boundingBox();
  const activeBox = await active.boundingBox();
  if (!barBox || !activeBox) throw new Error("选中项或指示条缺少 bounding box");
  expect(barBox.width).toBe(2);
  expect(Math.abs(barBox.x - activeBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(barBox.y + barBox.height / 2 - (activeBox.y + activeBox.height / 2))).toBeLessThanOrEqual(2);
  const barRadius = await bar.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(Number(barRadius.replace("px", ""))).toBeGreaterThan(0);
});

test("分组标题字号归一 text-xs 标准档（12px）", async ({ page }) => {
  await mockAdminEnv(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/admin/packs");
  await expect(page.getByTestId("域包行-学生-课程-成绩")).toBeVisible();

  const group = page.getByTestId("导航分组-域包管理");
  await expect(group).toBeVisible();
  // text-xs 标准档 = 0.75rem = 12px（已知字面值，独立于实现）
  const fontSize = await group.evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe("12px");
});
