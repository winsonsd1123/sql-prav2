import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";

// 域包详情页骨架 + 库骨架分区（票 #78 / spec #73 子票一基座）：/admin/packs/<packId>
// 独立路由只读预览，URL 可分享直达；列表行「详情」入口携带 packId 跳转。
// 本票交付页面骨架（分区导航结构）与库骨架分区（每张表的语义角色/表名池/行数/列/
// 值池/外键引用）；知识点清单 / 题目列表 / 难度档位与演练配置分区由后续票（#80/#81）补全。

// console 卫生：本 spec 打桩的响应均为 200，无需失败资源过滤。
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
});

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
        { role: "教师", permission: "访问后台", created_at: "2026-01-01" },
        { role: "教师", permission: "域包管理", created_at: "2026-01-01" },
      ]),
    });
  });
}

/** 列表页数据桩：云端资产表空（只展示内置两包）+ 列表页同源的放出/演练配置空桩
 *  （详情页复用同一加载层，跳转前后的全部请求保 console 卫生） */
async function attachDetailPageStubs(page: Page) {
  await createDomainPackAssetStub().attach(page);
  await createDomainPackVersionHistoryStub().attach(page);
  await page.route("**/api/admin/pack-exposure*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ packIds: [] }),
    });
  });
  await page.route("**/api/admin/domain-packs/practice-config*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packs: [] }) });
  });
}

test("列表行「详情」入口携带 packId 跳转详情页", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachDetailPageStubs(page);

  await page.goto("/admin/packs");
  await page.getByTestId("详情入口-学生-课程-成绩").click();
  await expect(page).toHaveURL(/\/admin\/packs\/student-course-grade$/);
  await expect(page.getByTestId("域包详情-学生-课程-成绩")).toBeVisible();
});

test("URL 直达详情页：分区导航结构与库骨架分区全量渲染", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachDetailPageStubs(page);

  // URL 直达（分享链接场景）：不带任何来路上下文直接访问
  await page.goto("/admin/packs/student-course-grade");
  await expect(page.getByTestId("域包详情-学生-课程-成绩")).toBeVisible();

  // 分区导航结构：四个分区锚点常显（本票库骨架落地，其余三个为后续票占位）
  const sectionNav = page.getByTestId("详情分区导航");
  await expect(sectionNav.getByRole("link", { name: "库骨架" })).toBeVisible();
  await expect(sectionNav.getByRole("link", { name: "知识点清单" })).toBeVisible();
  await expect(sectionNav.getByRole("link", { name: "题目列表" })).toBeVisible();
  await expect(sectionNav.getByRole("link", { name: "难度档位与演练配置" })).toBeVisible();

  // 库骨架分区：每张表渲染语义角色 / 表名池 / 行数 / 列（值池、外键引用）
  const skeleton = page.getByTestId("库骨架分区");
  await expect(skeleton.getByTestId("骨架表-学生")).toContainText("语义角色：学生");
  await expect(skeleton.getByTestId("骨架表-学生")).toContainText("表名池：学生、学员、同学");
  await expect(skeleton.getByTestId("骨架表-学生")).toContainText("行数：20");
  // 主键列（serialKey）也入列清单，标注起始值
  await expect(skeleton.getByTestId("骨架表-学生").getByTestId("骨架列-学号")).toContainText("主键");
  await expect(skeleton.getByTestId("骨架列-姓名")).toContainText("值池：张伟、李娜");
  await expect(skeleton.getByTestId("骨架列-城市")).toContainText("值池：北京、上海");

  // 外键关联可见：哪列引用哪表哪列（成绩.学号 → 学生.学号、成绩.课程号 → 课程.课程号）
  const gradeTable = skeleton.getByTestId("骨架表-成绩");
  await expect(gradeTable.getByTestId("骨架列-学号")).toContainText("引用 学生.学号");
  await expect(gradeTable.getByTestId("骨架列-课程号")).toContainText("引用 课程.课程号");
  await expect(gradeTable).toContainText("行数：45");
});

test("无「访问后台」权限直访详情页被拦回演练场", async ({ page }) => {
  // 学生角色不挂任何权限点（回退空集合 = 无权限，安全默认）
  await page.route("**/rest/v1/user_roles*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ user_id: "e2e-user", role: "学生", created_at: "2026-01-01" }]),
    });
  });
  await page.route("**/rest/v1/role_permissions*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  // 回跳目标演练场依赖的 API 离线桩（进度 / 放出 / 资产 / 版本历史，先例：admin-nav-structure）
  await page.route("**/rest/v1/practice_progress*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/pack_exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await attachDetailPageStubs(page);

  await page.goto("/admin/packs/student-course-grade");
  await expect(page).toHaveURL(/\/(\?.*)?$/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
});

test("有「访问后台」但无「域包管理」权限直访详情页被拦回列表页", async ({ page }) => {
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
      body: JSON.stringify([{ role: "教师", permission: "访问后台", created_at: "2026-01-01" }]),
    });
  });
  await attachDetailPageStubs(page);

  await page.goto("/admin/packs/student-course-grade");
  await expect(page).toHaveURL(/\/admin\/packs$/, { timeout: 10_000 });
  await expect(page.getByTestId("域包列表")).toBeVisible();
});

// —— 票 #81：题目列表分区（概要行 + 展开完整题）——

test("题目列表分区：概要行覆盖全部模板，含题面摘要/知识点归属/难度", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachDetailPageStubs(page);

  await page.goto("/admin/packs/student-course-grade");
  const section = page.getByTestId("题目列表分区");

  // 学生-课程-成绩内置包共 34 个题目模板：概要行数与包模板数一致
  await expect(section.getByTestId(/^题目概要行-/)).toHaveCount(34);

  // 概要行含题面摘要、知识点归属与难度
  const row = section.getByTestId("题目概要行-single-select-all");
  await expect(row).toContainText("查询所有学生的姓名。");
  await expect(row).toContainText("知识点：单表查询与投影");
  await expect(row).toContainText("难度：1");
  // 抽查另一知识点归属与更高难度
  await expect(section.getByTestId("题目概要行-comp-join-agg-having")).toContainText("知识点：综合应用");
  await expect(section.getByTestId("题目概要行-comp-join-agg-having")).toContainText("难度：5");
});

test("题目展开显示完整内容：题面/提示×2/参考答案/常见错误/参数池/有序性", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachDetailPageStubs(page);

  await page.goto("/admin/packs/student-course-grade");
  const section = page.getByTestId("题目列表分区");

  // 选带对象参数池、常见错误与行序敏感的模板（single-order-by-scholarship）点开验证
  await section.getByTestId("题目概要行-single-order-by-scholarship").click();
  const detail = section.getByTestId("题目完整内容-single-order-by-scholarship");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("题面：");
  await expect(detail).toContainText("提示一：");
  await expect(detail).toContainText("提示二：");
  await expect(detail).toContainText("参考答案：SELECT");
  await expect(detail).toContainText("常见错误：");
  await expect(detail).toContainText("参数池：排序方向：描述:从高到低·SQL:DESC、描述:从低到高·SQL:ASC");
  await expect(detail).toContainText("有序性：行序敏感（含 ORDER BY）");

  // 行序不敏感且无参数池的模板对照（agg-count-all：可选字段缺省不渲染对应行）
  await section.getByTestId("题目概要行-agg-count-all").click();
  const plain = section.getByTestId("题目完整内容-agg-count-all");
  await expect(plain).toBeVisible();
  await expect(plain).toContainText("有序性：行序不敏感");
  await expect(plain).not.toContainText("参数池：");
});
