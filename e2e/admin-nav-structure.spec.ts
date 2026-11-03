import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";
import { mkCloudPackJson } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";
import type { GateReport } from "../src/kernel/domain-pack-gate";

// 导航结构 spec（票 #71 / spec #64 收口验证）：两层导航渲染与选中态（含 aria-current）、
// 默认落地页为列表、生成/微调页高亮「域包列表」的前缀归属、生成终态回跳后导航归位、
// 六个子路由 URL 直达、无后台权限直访被守卫拦截。
// 刻意不与 domain-pack-list-page.spec（列表页 contract 四条）和
// domain-pack-generate-page.spec（生成全流程）重复：行内入口预选、列表纯度、
// 报告明细等断言由它们持有；本 spec 只看「导航结构」这一个接缝。

let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
});

/** mock 教师权限（访问后台 + 域包管理） */
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

/** 六个子路由页面依赖的 API 离线桩（列表 / 放出 / 演练配置 / 版本历史 + cloudPackStore 两表） */
async function attachSubRouteStubs(page: Page) {
  await createDomainPackAssetStub().attach(page);
  await createDomainPackVersionHistoryStub().attach(page);
  await page.route("**/api/admin/pack-exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });
  // 演练配置页在无可配置域包时整块退化为空态文案（暂无可配置的域包），
  // 故回放一个最小可配置包，保「演练配置管理」区块真实渲染
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

/** 断言导航中指定子项为唯一选中项（aria-current） */
async function expectOnlyCurrent(page: Page, label: string) {
  const nav = page.getByTestId("后台侧边导航");
  const labels = ["用户管理", "邮箱白名单", "域包列表", "版本历史", "放出管理", "演练配置"];
  for (const item of labels) {
    const link = nav.getByRole("link", { name: item, exact: true });
    if (item === label) {
      await expect(link).toHaveAttribute("aria-current", "page");
    } else {
      await expect(link).not.toHaveAttribute("aria-current", "page");
    }
  }
}

test("两层导航渲染：直达两项 + 域包管理分组，四个子项常显不折叠", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachSubRouteStubs(page);

  await page.goto("/admin/packs");
  const nav = page.getByTestId("后台侧边导航");
  // 第一层直达：用户管理 / 邮箱白名单
  await expect(nav.getByRole("link", { name: "用户管理" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "邮箱白名单" })).toBeVisible();
  // 第一层分组：域包管理为不可点分隔（无链接语义），非折叠组
  const group = page.getByTestId("导航分组-域包管理");
  await expect(group).toBeVisible();
  await expect(group.getByRole("link")).toHaveCount(0);
  // 第二层子项常显：四个子功能点全部直接可见（无需交互展开）
  await expect(nav.getByRole("link", { name: "域包列表", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "版本历史", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "放出管理", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "演练配置", exact: true })).toBeVisible();
});

test("当前子项选中态与 aria-current：导航四子项各自唯一选中", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachSubRouteStubs(page);

  // 列表（根路径即「域包列表」）
  await page.goto("/admin/packs");
  await expect(page.getByTestId("域包行-学生-课程-成绩")).toBeVisible();
  await expectOnlyCurrent(page, "域包列表");

  // 版本历史 / 放出管理 / 演练配置：巡检式导航直达，各归其子项
  await page.goto("/admin/packs/versions");
  await expect(page.getByTestId("版本历史目标域包")).toBeVisible();
  await expectOnlyCurrent(page, "版本历史");

  await page.goto("/admin/packs/exposure");
  await expect(page.getByTestId("域包放出管理")).toBeVisible();
  await expectOnlyCurrent(page, "放出管理");

  await page.goto("/admin/packs/practice-config");
  await expect(page.getByTestId("演练配置管理")).toBeVisible();
  await expectOnlyCurrent(page, "演练配置");
});

test("进入域包管理默认落在域包列表（无重定向）", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachSubRouteStubs(page);

  await page.goto("/admin/packs");
  // 直接落列表根路径（不做任何跳转），列表内容与选中态都在
  await expect(page).toHaveURL(/\/admin\/packs$/);
  await expect(page.getByTestId("域包行-学生-课程-成绩")).toBeVisible();
  await expect(page.getByTestId("后台侧边导航").getByRole("link", { name: "域包列表", exact: true })).toHaveAttribute("aria-current", "page");
});

test("生成页与微调页不在导航列示，但期间高亮「域包列表」", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachSubRouteStubs(page);

  await page.goto("/admin/packs/generate");
  await expect(page.getByTestId("场景描述")).toBeVisible();
  await expectOnlyCurrent(page, "域包列表");

  // 微调页携带 ?packId= 预选也不影响归属（query 不参与 active 判定）
  await page.goto("/admin/packs/refine?packId=student-course-grade");
  await expect(page.getByTestId("微调目标域包")).toContainText("（student-course-grade）");
  await expectOnlyCurrent(page, "域包列表");
});

/** 通过态闸门报告夹具（口径与 domain-pack-generate-page.spec 一致） */
const passedReport: GateReport = {
  passed: true,
  structural: { status: "通过", issues: [], checkedTables: 3, checkedTemplates: 30 },
  generation: { status: "通过", issues: [], seeds: [20260101, 42] },
  selfJudging: { status: "通过", issues: [], checkedTemplates: 30, seed: 20260101 },
};

test("生成终态回跳：发布成功与放弃草稿均回域包列表且导航归位", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachSubRouteStubs(page);
  await page.route("**/api/admin/domain-packs/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: mkCloudPackJson({ packId: "library-borrow", name: "图书馆借阅" }), report: passedReport }),
    });
  });
  await page.route("**/api/admin/domain-packs/publish", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, packId: "library-borrow" }),
    });
  });

  // —— 发布成功 → 回列表 ——
  await page.goto("/admin/packs/generate");
  await page.getByTestId("场景描述").fill("图书馆借阅场景：读者、图书、借阅记录");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("验证报告")).toContainText("验证通过：可确认发布");
  await page.getByRole("button", { name: "确认发布" }).click();
  await expect(page).toHaveURL(/\/admin\/packs$/);
  await expectOnlyCurrent(page, "域包列表");

  // —— 放弃草稿 → 回列表 ——
  await page.goto("/admin/packs/generate");
  await page.getByTestId("场景描述").fill("另一个场景：影院、影片、排片");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByTestId("验证报告")).toContainText("验证通过：可确认发布");
  await page.getByRole("button", { name: "放弃本次草稿" }).click();
  await expect(page).toHaveURL(/\/admin\/packs$/);
  await expectOnlyCurrent(page, "域包列表");
});

test("六个功能点子路由 URL 直达均可用", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachSubRouteStubs(page);

  const routes: Array<[string, string]> = [
    ["/admin/packs", "域包行-学生-课程-成绩"],
    ["/admin/packs/generate", "场景描述"],
    ["/admin/packs/refine", "微调目标域包"],
    ["/admin/packs/versions", "版本历史目标域包"],
    ["/admin/packs/exposure", "域包放出管理"],
    ["/admin/packs/practice-config", "演练配置管理"],
  ];
  for (const [route, testid] of routes) {
    await page.goto(route);
    await expect(page.getByTestId(testid)).toBeVisible();
  }
});

test("无后台权限直访任何域包管理子路由均被守卫拦截回演练场", async ({ page }) => {
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
  // 回跳目标演练场依赖的 API 离线桩（进度 / 放出 / 资产 / 版本历史）
  await page.route("**/rest/v1/practice_progress*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/pack_exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await attachSubRouteStubs(page);

  const subRoutes = [
    "/admin/packs",
    "/admin/packs/generate",
    "/admin/packs/refine",
    "/admin/packs/versions",
    "/admin/packs/exposure",
    "/admin/packs/practice-config",
  ];
  for (const route of subRoutes) {
    await page.goto(route);
    // 守卫 router.replace("/")：回演练场根路径（客户端路由会补默认 ?seed=）
    await expect(page).toHaveURL(/\/(\?.*)?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  }
});
