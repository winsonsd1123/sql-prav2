import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, expectConsoleClean, createCloudProgressStub, createDomainPackVersionHistoryStub, chooseSelectOption } from "./helpers";
import packAJson from "../src/domain-packs/student-course-grades/pack-a.json";

// 难度配额抽题与演练配置（票 #61 / spec #53 目标②）：教师改配置 → 学生开练题数随之变化；
// 非法配置前端即拦、服务端重校验为权威。401/403 与契约校验在服务层单测断言，不在此重复。

// console 卫生：全用例期间页面不得出现 console.error/warning 或未捕获异常。
// 仅桩 422 闸门拒绝的失败用例豁免其资源加载报错（用例内置位标记），其余用例零豁免。
const STUBBED_FAILURE_RESOURCE = /Failed to load resource: the server responded with a status of 422/;
let consoleProblems: string[] = [];
let stubbedFailureCase = false;
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  stubbedFailureCase = false;
  await presetLoginState(page);
});
test.afterEach(() => {
  expectConsoleClean(consoleProblems, stubbedFailureCase ? [STUBBED_FAILURE_RESOURCE] : []);
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
  // 同页的放出管理区块也拉自己的 API：桩成未配置（空清单），避免真实 401 打进 console 卫生断言
  await page.route("**/api/admin/pack-exposure", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

/** mock 学生权限（无任何权限点）与空放出清单（未配置 = 全放） */
async function mockStudentSide(page: Page) {
  await page.route("**/rest/v1/user_roles*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/role_permissions*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/pack_exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  // 版本历史表（票 #62 加载层随资产表一并拉取）：空桩避免漏出真实请求（anon 401 打进 console 卫生）
  await createDomainPackVersionHistoryStub().attach(page);
  await createCloudProgressStub().attach(page);
}

/** /api/admin/domain-packs/practice-config 有状态桩：GET 回放内存状态；PUT 记录并更新（保存后刷新可见） */
async function mockPracticeConfigAdminApi(page: Page) {
  const state = {
    packs: [
      {
        packId: "student-course-grade",
        name: "学生-课程-成绩",
        practiceConfig: { totalQuestions: 10, tierDistribution: { "1": 1, "2": 3, "3": 3, "4": 2, "5": 1 } },
        tierTemplateCounts: { "1": 3, "2": 12, "3": 10, "4": 7, "5": 2 },
      },
      {
        packId: "employee-department-payroll",
        name: "员工-部门-薪资",
        practiceConfig: { totalQuestions: 10, tierDistribution: { "1": 1, "2": 3, "3": 3, "4": 2, "5": 1 } },
        tierTemplateCounts: { "1": 3, "2": 10, "3": 10, "4": 6, "5": 1 },
      },
    ],
  };
  const calls = { put: [] as unknown[] };
  await page.route("**/api/admin/domain-packs/practice-config", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state) });
      return;
    }
    const body = route.request().postDataJSON() as { packId: string; practiceConfig: unknown };
    calls.put.push(body);
    const entry = state.packs.find((p) => p.packId === body.packId);
    if (entry) entry.practiceConfig = body.practiceConfig as typeof entry.practiceConfig;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, packId: body.packId, practiceConfig: body.practiceConfig }),
    });
  });
  return { calls, state };
}

/** #60 起管理页挂域包列表（pack-exposure GET + cloudPackStore 拉云端资产表）：离线桩保 console 卫生 */
async function mockAdminPageSiblingBlocks(page: Page) {
  await page.route("**/api/admin/pack-exposure", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });
  await page.route("**/rest/v1/domain_pack_asset*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  // 票 #62：管理页复用 cloudPackStore，随资产表一并拉版本历史表，离线空桩保 console 卫生
  await createDomainPackVersionHistoryStub().attach(page);
}

/** 学生端 domain_pack_asset 桩：回放含 7 题配置的内置包A 资产行（云端同 id 覆盖演练配置） */
async function mockDomainPackAssetRows(page: Page, rows: unknown[]) {
  await page.route("**/rest/v1/domain_pack_asset*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

test("教师把内置包A 配置改为 7 题：学生端开练题数变为 7，换一套仍按配置生成", async ({ page }) => {
  // —— 教师端：/admin/packs 把「学生-课程-成绩」总题数改 7（1/2/2/1/1）并保存 ——
  await mockTeacherPermissions(page);
  const { calls } = await mockPracticeConfigAdminApi(page);
  await mockAdminPageSiblingBlocks(page);
  await page.goto("/admin/packs/practice-config");
  await expect(page.getByTestId("演练配置管理")).toBeVisible();
  await expect(page.getByTestId("演练配置总题数")).toHaveValue("10");
  await page.getByTestId("演练配置总题数").fill("7");
  await page.getByTestId("演练配置档位-2").fill("2");
  await page.getByTestId("演练配置档位-3").fill("2");
  await page.getByTestId("演练配置档位-4").fill("1");
  await page.getByTestId("演练配置档位-5").fill("1");
  await page.getByRole("button", { name: "保存演练配置" }).click();
  await expect(page.getByTestId("演练配置提示")).toContainText("已保存");
  expect(calls.put).toEqual([
    {
      packId: "student-course-grade",
      practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } },
    },
  ]);

  // —— 学生端：云端同 id 资产行携带 7 题配置 → 开练第 1/7 题 ——
  await mockStudentSide(page);
  await mockDomainPackAssetRows(page, [
    {
      pack_id: "student-course-grade",
      asset: { ...packAJson, practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } } },
    },
  ]);
  await page.goto("/?seed=42");
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  await expect(page.getByText("第 1/7 题")).toBeVisible({ timeout: 15000 });
  // 换一套（新种子）仍按当前配置生成 7 题
  await page.getByRole("button", { name: "换一套" }).click();
  await expect(page.getByText("第 1/7 题")).toBeVisible({ timeout: 15000 });
});

test("域包下拉切换（票 #97）：草稿回填为所选包配置，保存载荷携带所选 packId，刷新后选中保持", async ({ page }) => {
  await mockTeacherPermissions(page);
  const { calls } = await mockPracticeConfigAdminApi(page);
  await mockAdminPageSiblingBlocks(page);
  await page.goto("/admin/packs/practice-config");
  const packSelect = page.getByTestId("演练配置域包选择");
  await expect(packSelect).toContainText("（student-course-grade）");
  await page.getByTestId("演练配置总题数").fill("8"); // 未保存的草稿随切换丢弃
  await chooseSelectOption(page, "演练配置域包选择", "（employee-department-payroll）");
  await expect(packSelect).toContainText("（employee-department-payroll）");
  await expect(page.getByTestId("演练配置总题数")).toHaveValue("10");
  await expect(page.getByTestId("演练配置管理")).toContainText("档4（模板 6）");
  await page.getByTestId("演练配置总题数").fill("9");
  await page.getByTestId("演练配置档位-4").fill("1");
  await page.getByRole("button", { name: "保存演练配置" }).click();
  await expect(page.getByTestId("演练配置提示")).toContainText("已保存");
  expect(calls.put).toEqual([
    {
      packId: "employee-department-payroll",
      practiceConfig: { totalQuestions: 9, tierDistribution: { "1": 1, "2": 3, "3": 3, "4": 1, "5": 1 } },
    },
  ]);
  await expect(packSelect).toContainText("（employee-department-payroll）");
  await expect(page.getByTestId("演练配置总题数")).toHaveValue("9");
});

test("切包后立即输入不被覆盖（票 #103）：切包纯本地回填不重拉，仅保存后重拉一次", async ({ page }) => {
  await mockTeacherPermissions(page);
  const { calls } = await mockPracticeConfigAdminApi(page);
  await mockAdminPageSiblingBlocks(page);
  // 后注册先匹配：计数 GET，并把首拉之后的 GET 延迟 300ms 放大覆盖窗口（若切包仍重拉，回包必晚于填写落地）
  let getCount = 0;
  await page.route("**/api/admin/domain-packs/practice-config", async (route) => {
    if (route.request().method() === "GET") {
      getCount += 1;
      if (getCount > 1) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.fallback();
  });
  await page.goto("/admin/packs/practice-config");
  await expect(page.getByTestId("演练配置总题数")).toHaveValue("10");
  await page.waitForLoadState("networkidle");
  const getsAfterMount = getCount;

  await chooseSelectOption(page, "演练配置域包选择", "（employee-department-payroll）");
  await page.getByTestId("演练配置总题数").fill("9");
  await page.getByTestId("演练配置档位-4").fill("1");
  // 等过桩延迟：若切包仍触发重拉，其回包此时已落地并重置草稿，下方断言即红
  await page.waitForTimeout(600);
  await expect(page.getByTestId("演练配置总题数")).toHaveValue("9");
  await expect(page.getByTestId("演练配置档位-4")).toHaveValue("1");
  expect(getCount).toBe(getsAfterMount);

  const saveButton = page.getByRole("button", { name: /保存演练配置|保存中/ });
  await saveButton.click();
  await expect(page.getByTestId("演练配置提示")).toContainText("已保存");
  await expect(saveButton).toHaveText("保存演练配置"); // 保存后重拉落定才复位 busy
  expect(calls.put).toEqual([
    {
      packId: "employee-department-payroll",
      practiceConfig: { totalQuestions: 9, tierDistribution: { "1": 1, "2": 3, "3": 3, "4": 1, "5": 1 } },
    },
  ]);
  expect(getCount).toBe(getsAfterMount + 1);
});

test("非法配置（各档总和不等于总题数）前端即拦：按钮禁用、不出 PUT 请求", async ({ page }) => {
  await mockTeacherPermissions(page);
  const { calls } = await mockPracticeConfigAdminApi(page);
  await mockAdminPageSiblingBlocks(page);
  await page.goto("/admin/packs/practice-config");
  await expect(page.getByTestId("演练配置管理")).toBeVisible();
  await page.getByTestId("演练配置总题数").fill("7"); // 各档合计仍为 10
  await expect(page.getByTestId("演练配置校验提示")).toContainText("必须等于总题数");
  await expect(page.getByRole("button", { name: "保存演练配置" })).toBeDisabled();
  expect(calls.put).toEqual([]);
});

test("非法配置（配额超该档模板数）前端即拦：按钮禁用、不出 PUT 请求", async ({ page }) => {
  await mockTeacherPermissions(page);
  const { calls } = await mockPracticeConfigAdminApi(page);
  await mockAdminPageSiblingBlocks(page);
  await page.goto("/admin/packs/practice-config");
  await expect(page.getByTestId("演练配置管理")).toBeVisible();
  // 默认包 student-course-grade 档5模板仅 2（票 #117）：配 3 即超限；总题数同步改 12，各档总和一致以隔离出唯一错误
  await page.getByTestId("演练配置总题数").fill("12");
  await page.getByTestId("演练配置档位-5").fill("3");
  await expect(page.getByTestId("演练配置校验提示")).toContainText("不得超过该档模板数");
  await expect(page.getByRole("button", { name: "保存演练配置" })).toBeDisabled();
  expect(calls.put).toEqual([]);
});

test("保存被验证闸门拒绝（PUT 422 report，票 #115）：toast 逐条透出 report 问题文案而非兜底", async ({ page }) => {
  stubbedFailureCase = true;
  await mockTeacherPermissions(page);
  await mockPracticeConfigAdminApi(page);
  await mockAdminPageSiblingBlocks(page);
  // 后注册先匹配：PUT 桩成 422 闸门拒绝（与发布路由同口径的 report 形状），GET 走有状态桩
  const puts: unknown[] = [];
  await page.route("**/api/admin/domain-packs/practice-config", async (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          report: {
            passed: false,
            structural: {
              status: "失败",
              checkedTables: 3,
              checkedTemplates: 30,
              issues: [{ check: "结构", templateId: "tpl-07", message: "难度必须是 1-5，实际 9" }],
            },
            generation: { status: "跳过", issues: [], seeds: [20260101, 42] },
            selfJudging: { status: "跳过", issues: [], checkedTemplates: 0, seed: 20260101 },
          },
        }),
      });
      return;
    }
    await route.fallback();
  });
  await page.goto("/admin/packs/practice-config");
  await page.getByRole("button", { name: "保存演练配置" }).click();
  const feedback = page.getByTestId("演练配置提示");
  await expect(feedback).toContainText("保存被验证闸门拒绝");
  await expect(feedback).toContainText("[结构]（tpl-07） 难度必须是 1-5，实际 9");
  await expect(feedback).not.toContainText("演练配置保存失败");
  expect(puts).toEqual([
    {
      packId: "student-course-grade",
      practiceConfig: { totalQuestions: 10, tierDistribution: { "1": 1, "2": 3, "3": 3, "4": 2, "5": 1 } },
    },
  ]);
});
