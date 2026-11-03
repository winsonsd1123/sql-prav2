import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub, createDomainPackVersionHistoryStub } from "./helpers";
import { mkCloudPackJson } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";
import type { GateReport } from "../src/kernel/domain-pack-gate";

// 域包微调端到端（票 #67 / spec #64：微调独立路由页 /admin/packs/refine）：?packId= 预选
// 目标域包（列表行内入口的跳转契约），参数缺失或无效回退页内选择器。流程行为（B 类产生
// 新版本、进行中会话钉旧版；失败保留表单可重试）沿用票 #62 口径，迁移到新路由复验。
// LLM 打桩沿用 #60 管理页 spec 的浏览器层 page.route 设计（服务端出站与生产零改动）。

// console 卫生：同 domain-pack-admin-page.spec（打桩失败响应的资源错误按用例事实过滤）。
const STUBBED_FAILURE_RESOURCE = /Failed to load resource: the server responded with a status of (502|503)/;
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page).filter((m) => !STUBBED_FAILURE_RESOURCE.test(m));
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

const passedReport: GateReport = {
  passed: true,
  structural: { status: "通过", issues: [], checkedTables: 3, checkedTemplates: 28 },
  generation: { status: "通过", issues: [], seeds: [20260101, 42] },
  selfJudging: { status: "通过", issues: [], checkedTemplates: 28, seed: 20260101 },
};

/** B 类微调草稿：全部模板题面加「（微调）」——参与种子生成的内容变，新旧会话题面可分辨 */
function mkRefinedPackJson(basePackId: string) {
  const v1 = mkCloudPackJson({ packId: basePackId });
  const draft = mkCloudPackJson({
    packId: `${basePackId}@v2`,
    templates: (v1.templates as { prompt: string }[]).map((t) => ({ ...t, prompt: `${t.prompt}（微调）` })),
  });
  return { v1, draft };
}

test("packId 预选：B 类微调→确认产生 v2，学生旧会话钉旧版题面，切换胶囊进入新版", async ({ page }) => {
  await mockTeacherPermissions(page);
  const BASE = "library-loan";
  const { v1, draft } = mkRefinedPackJson(BASE);
  const assetStub = createDomainPackAssetStub();
  assetStub.rows.push({ pack_id: BASE, asset: v1 });
  await assetStub.attach(page);
  // 版本历史表桩：确认生效前为空，apply 桩原子追加旧版本（模拟服务端 B 类落库结果）
  const historyRows: { pack_id: string; asset: unknown }[] = [];
  await page.route("**/rest/v1/domain_pack_version_history*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historyRows) });
  });

  // 微调 API 桩：回放 B 类草稿 + 通过态报告 + 版本预告
  await page.route("**/api/admin/domain-packs/refine", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft,
        report: passedReport,
        changeClass: "B",
        currentVersionLabel: "v1",
        nextVersionLabel: "v2",
      }),
    });
  });
  // 生效 API 桩：模拟服务端 B 类落库——当前行换新版本资产（落库键恒基础名）、旧资产进历史表
  await page.route("**/api/admin/domain-packs/refine/apply", async (route: Route) => {
    assetStub.rows.length = 0;
    assetStub.rows.push({ pack_id: BASE, asset: draft });
    historyRows.push({ pack_id: `${BASE}@v2`, asset: v1 });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ packId: `${BASE}@v2`, changeClass: "B", versionLabel: "v2" }),
    });
  });
  // 版本历史查询 API 桩：与表桩同源（当前 v2 + 历史 v1）
  await page.route("**/api/admin/domain-packs/versions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: [
          { packId: `${BASE}@v2`, versionLabel: "v2", name: draft.name, createdAt: "2026-11-01", isCurrent: true },
          { packId: BASE, versionLabel: "v1", name: v1.name, createdAt: "2026-10-01", isCurrent: false },
        ],
      }),
    });
  });

  // 列表页放出清单桩（终态回跳落地 /admin/packs 后列表拉取，离线桩保 console 卫生）
  await page.route("**/api/admin/pack-exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });

  // —— 带目标直达微调页：packId 已预选，无需手动选择 ——
  await page.goto(`/admin/packs/refine?packId=${BASE}`);
  await expect(page.getByTestId("微调目标域包")).toHaveValue(BASE);
  await page.getByTestId("修改意图").fill("把题目模板的题面写得更贴合借阅业务");
  await page.getByTestId("微调SQL样例").fill("SELECT 姓名 FROM 读者 JOIN 借阅 ON …");
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("微调等待提示")).toContainText("正在生成");
  await expect(page.getByTestId("改动分类提示")).toContainText("B 类改动");
  await expect(page.getByTestId("改动分类提示")).toContainText("v2");
  await expect(page.getByTestId("微调报告")).toContainText("验证通过");
  await page.getByTestId("确认生效").click();

  // —— 终态回跳（spec #64 决策 6）：生效成功后回域包列表，行内 packId 即新版本可核对 ——
  // （「再微调一轮」按钮随回跳失去宿主属预期——旧单页交互残留，由列表行内「微调」入口承接）
  await expect(page).toHaveURL(/\/admin\/packs$/);
  await expect(page.getByTestId("域包行-云端夹具域包")).toContainText("library-loan@v2");

  // —— 版本历史核对：跳独立版本历史页（#70 拆分后 /admin/packs 为纯列表页），v2 置顶标「当前」 ——
  await page.goto(`/admin/packs/versions?packId=${BASE}`);
  await expect(page.getByTestId("版本历史目标域包")).toHaveValue(BASE);
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
  await expect(page.getByTestId("版本历史列表")).toContainText("历史（旧会话钉住）");

  // —— 学生端：进行中会话（旧 packId 钉 localStorage）加载旧版本题面 ——
  await page.route("**/rest/v1/pack_exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript((base) => {
    localStorage.setItem("sql-playground:pack", base);
  }, BASE);
  await page.goto("/?seed=42");
  await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  const oldPrompt = page.getByText(/云端夹具第 \d+ 题/).first();
  await expect(oldPrompt).toBeVisible({ timeout: 15000 });
  // 旧会话题面不含微调后缀：钉旧版，不错配新版本
  await expect(page.getByText(/（微调）/)).toHaveCount(0);

  // —— 切换胶囊（展示注册表只留最新版）→ 新会话用 v2 题面 ——
  await page.getByRole("button", { name: "云端夹具域包" }).click();
  await expect(page.getByText(/云端夹具第 \d+ 题：.+（微调）/).first()).toBeVisible();
});

test("微调失败（502）：明确错误，表单与意图保留可重试", async ({ page }) => {
  await mockTeacherPermissions(page);
  const assetStub = createDomainPackAssetStub();
  assetStub.rows.push({ pack_id: "library-loan", asset: mkCloudPackJson({ packId: "library-loan" }) });
  await assetStub.attach(page);
  await page.route("**/rest/v1/domain_pack_version_history*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  let calls = 0;
  await page.route("**/api/admin/domain-packs/refine", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ code: "llm_error", error: "LLM 网络请求失败，可重试", retryable: true }),
      });
      return;
    }
    // 第二次回放 A 类草稿（仅改难度档位描述）：题面不变、packId 不变
    const aDraft = mkCloudPackJson({
      packId: "library-loan",
      difficultyTiers: (mkCloudPackJson().difficultyTiers as { level: number; description: string }[]).map((t) => ({
        ...t,
        description: `${t.description}（补充说明）`,
      })),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: aDraft, report: passedReport, changeClass: "A", currentVersionLabel: "v1", nextVersionLabel: "v1" }),
    });
  });

  await page.goto("/admin/packs/refine?packId=library-loan");
  await expect(page.getByTestId("微调目标域包")).toHaveValue("library-loan");
  await page.getByTestId("修改意图").fill("给难度档位补充样例");
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("微调失败提示")).toContainText("LLM 网络请求失败");
  await expect(page.getByTestId("修改意图")).toHaveValue("给难度档位补充样例");
  // 重试 → 第二次成功进入报告态（A 类：即时生效、packId 不变）
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("改动分类提示")).toContainText("A 类改动");
  await expect(page.getByTestId("改动分类提示")).toContainText("packId 不变");
});

test("不带参数直达微调页：页内选择器兜底可用", async ({ page }) => {
  await mockTeacherPermissions(page);
  const assetStub = createDomainPackAssetStub();
  assetStub.rows.push({ pack_id: "library-loan", asset: mkCloudPackJson({ packId: "library-loan" }) });
  await assetStub.attach(page);

  await page.goto("/admin/packs/refine");
  // 未携带目标：选择器落在占位项，可自行选择域包
  await expect(page.getByTestId("微调目标域包")).toHaveValue("");
  await page.getByTestId("微调目标域包").selectOption("library-loan");
  await expect(page.getByTestId("微调目标域包")).toHaveValue("library-loan");
});

test("packId 参数无效：回退页内选择器兜底，不落在不存在的选项上", async ({ page }) => {
  await mockTeacherPermissions(page);
  const assetStub = createDomainPackAssetStub();
  assetStub.rows.push({ pack_id: "library-loan", asset: mkCloudPackJson({ packId: "library-loan" }) });
  await assetStub.attach(page);

  await page.goto("/admin/packs/refine?packId=不存在的域包");
  await expect(page.getByTestId("微调目标域包")).toHaveValue("");
  await page.getByTestId("微调目标域包").selectOption("library-loan");
  await expect(page.getByTestId("微调目标域包")).toHaveValue("library-loan");
});

// —— 票 #85：元素微调（弹道一：单道题目模板）——
// 详情页选中单道题目 → 下指令 → 草稿预览 + 闸门报告 → 确认生效走既有 apply 链
//（改题目模板属 B 类 → 产生新版本，版本页可见）。执行机制仍是全量重发，
// 请求体携带 targetTemplateId 由服务端写进提示词（服务层测试断言提示词承载）。

test("元素微调闭环：详情页选中单道题目→指令→草稿报告→确认生效 B 类新版本（版本页可见）", async ({ page }) => {
  await mockTeacherPermissions(page);
  // 详情页走展示清单（内置包即可），同源放出/演练配置空桩保 console 卫生
  await createDomainPackAssetStub().attach(page);
  await createDomainPackVersionHistoryStub().attach(page);
  await page.route("**/api/admin/pack-exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });
  await page.route("**/api/admin/domain-packs/practice-config*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packs: [] }) });
  });

  const BASE = "student-course-grade";
  const TARGET = "single-select-all";
  // 元素微调草稿（B 类）：只改目标题目的题面，其余逐字保留
  const current = mkCloudPackJson({ packId: BASE });
  const draft = mkCloudPackJson({
    packId: `${BASE}@v2`,
    templates: (current.templates as { templateId: string; prompt: string }[]).map((t) =>
      t.templateId === TARGET ? { ...t, prompt: `${t.prompt}（元素微调）` } : t,
    ),
  });

  // 微调 API 桩：断言请求载荷携带目标题目标识（元素定位经请求体进入服务端提示词）
  let refinePayload: { targetTemplateId?: string } | null = null;
  await page.route("**/api/admin/domain-packs/refine", async (route) => {
    refinePayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft, report: passedReport, changeClass: "B", currentVersionLabel: "v1", nextVersionLabel: "v2" }),
    });
  });
  await page.route("**/api/admin/domain-packs/refine/apply", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ packId: `${BASE}@v2`, changeClass: "B", versionLabel: "v2" }),
    });
  });
  await page.route("**/api/admin/domain-packs/versions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: [
          { packId: `${BASE}@v2`, versionLabel: "v2", name: "云端夹具域包", createdAt: "2026-11-03", isCurrent: true },
          { packId: BASE, versionLabel: "v1", name: "云端夹具域包", createdAt: "2026-10-01", isCurrent: false },
        ],
      }),
    });
  });

  // —— 详情页：题目概要行可选中，选中态清晰可见 ——
  await page.goto(`/admin/packs/${BASE}`);
  const section = page.getByTestId("题目列表分区");
  await section.getByTestId(`题目选中按钮-${TARGET}`).click();
  await expect(section.getByTestId(`题目选中按钮-${TARGET}`)).toHaveAttribute("aria-pressed", "true");
  // 选中后浮现元素微调面板，明示目标题目标识
  await expect(page.getByTestId("元素微调目标")).toContainText(TARGET);

  // —— 指令 → 草稿预览 + 闸门报告（B 类预告 v2）——
  await page.getByTestId("修改意图").fill("把这道题的提示写得更具体");
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("改动分类提示")).toContainText("B 类改动");
  await expect(page.getByTestId("改动分类提示")).toContainText("v2");
  await expect(page.getByTestId("微调报告")).toContainText("验证通过");

  // —— 确认生效：既有 apply 链，B 类产生新版本 ——
  await page.getByTestId("确认生效").click();
  await expect(page.getByTestId("微调生效反馈")).toContainText("B 类改动");
  // 请求载荷确实携带元素定位（e2e 惯例：断言请求载荷而非组件内部状态）
  expect(refinePayload).toMatchObject({ packId: BASE, targetTemplateId: TARGET });

  // —— 版本页可见新版本 v2（当前）——
  await page.goto(`/admin/packs/versions?packId=${BASE}`);
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
  await expect(page.getByTestId("版本历史列表")).toContainText(`${BASE}@v2`);
});

// —— 票 #87：元素微调弹道二——表 / 知识点条目 / 多题框选（沿用 #85 选中框架）——
// 定位机制沿用 #85 的扁平 target 字段族：targetTable / targetKnowledgeArea /
// targetTemplateIds（单题 targetTemplateId 由 #85 用例覆盖），e2e 断言请求载荷。

/** 详情页元素微调的公共桩：内置包详情 + 微调/生效/版本 API 打桩（草稿与回执由用例定制；
 *  生效响应可定制状态码——词表拒绝用例返回 400） */
async function stubDetailRefineApis(
  page: Page,
  refineBody: () => unknown,
  applyResponse: () => { status: number; body: unknown },
) {
  await createDomainPackAssetStub().attach(page);
  await createDomainPackVersionHistoryStub().attach(page);
  await page.route("**/api/admin/pack-exposure*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });
  await page.route("**/api/admin/domain-packs/practice-config*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packs: [] }) });
  });
  let payload: Record<string, unknown> | null = null;
  await page.route("**/api/admin/domain-packs/refine", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(refineBody()),
    });
  });
  await page.route("**/api/admin/domain-packs/refine/apply", async (route) => {
    const { status, body } = applyResponse();
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return () => payload;
}

test("表选中微调：详情页选中骨架表（含外键调整）→指令→请求载荷携带 targetTable，B 类生效", async ({ page }) => {
  await mockTeacherPermissions(page);
  const BASE = "student-course-grade";
  // 表微调草稿（B 类）：把「成绩」表行数调整
  const draft = mkCloudPackJson({
    packId: `${BASE}@v2`,
    schemaSkeleton: (mkCloudPackJson().schemaSkeleton as { tableRole: string; rowCount: number }[]).map((t) =>
      t.tableRole === "成绩" ? { ...t, rowCount: 45 } : t,
    ),
  });
  const getPayload = await stubDetailRefineApis(
    page,
    () => ({ draft, report: passedReport, changeClass: "B", currentVersionLabel: "v1", nextVersionLabel: "v2" }),
    () => ({ status: 200, body: { packId: `${BASE}@v2`, changeClass: "B", versionLabel: "v2" } }),
  );

  await page.goto(`/admin/packs/${BASE}`);
  const section = page.getByTestId("库骨架分区");
  await section.getByTestId("表选中按钮-成绩").click();
  await expect(section.getByTestId("表选中按钮-成绩")).toHaveAttribute("aria-pressed", "true");
  // 选中后浮现元素微调面板，明示目标表
  await expect(page.getByTestId("元素微调目标")).toContainText("成绩");
  await expect(page.getByTestId("元素微调目标")).toContainText("表");

  await page.getByTestId("修改意图").fill("把成绩表的外键改成指向课程表课程号");
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("改动分类提示")).toContainText("B 类改动");
  await page.getByTestId("确认生效").click();
  await expect(page.getByTestId("微调生效反馈")).toContainText("B 类改动");
  // 请求载荷确实携带表定位（e2e 惯例：断言请求载荷而非组件内部状态）
  expect(getPayload()).toMatchObject({ packId: BASE, targetTable: "成绩" });
});

test("知识点条目选中微调：请求载荷携带 targetKnowledgeArea，词表越界草稿被闸门拒绝并明示原因", async ({ page }) => {
  await mockTeacherPermissions(page);
  const BASE = "student-course-grade";
  // 知识点微调草稿（B 类）：清单改序——结构闸门可过，apply 阶段被词表闸门拒绝
  const areas = mkCloudPackJson().knowledgeAreas as string[];
  const reordered = [...areas.filter((a) => a !== "聚合与分组"), "聚合与分组"];
  const draft = mkCloudPackJson({
    packId: `${BASE}@v2`,
    knowledgeAreas: reordered,
    knowledgeAreaRefIds: reordered.map((_, i) => `ka-${i + 1}`),
  });
  const getPayload = await stubDetailRefineApis(
    page,
    () => ({ draft, report: passedReport, changeClass: "B", currentVersionLabel: "v1", nextVersionLabel: "v2" }),
    // 生效桩返回 400（词表拒绝的协议映射，#83 apply 路由现状）
    () => ({ status: 400, body: { error: "知识点词表引用不存在：ka-99（第 2 项）" } }),
  );

  await page.goto(`/admin/packs/${BASE}`);
  const section = page.getByTestId("知识点清单分区");
  await section.getByTestId("知识点选中按钮-聚合与分组").click();
  await expect(section.getByTestId("知识点选中按钮-聚合与分组")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("元素微调目标")).toContainText("知识点");
  await expect(page.getByTestId("元素微调目标")).toContainText("聚合与分组");

  await page.getByTestId("修改意图").fill("把该知识点移到清单更靠后");
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("改动分类提示")).toContainText("B 类改动");
  expect(getPayload()).toMatchObject({ packId: BASE, targetKnowledgeArea: "聚合与分组" });

  // —— 确认生效被词表闸门拒绝：中文原因明示，不静默 ——
  await page.getByTestId("确认生效").click();
  await expect(page.getByTestId("微调失败提示")).toContainText("词表引用不存在");
});

test("多题框选批量微调：两题同时框选→请求载荷携带 targetTemplateIds 数组", async ({ page }) => {
  await mockTeacherPermissions(page);
  const BASE = "student-course-grade";
  const TARGETS = ["single-select-all", "single-select-distinct-city"];
  // 批量草稿（B 类）：两道目标题的题面统一加后缀
  const draft = mkCloudPackJson({
    packId: `${BASE}@v2`,
    templates: (mkCloudPackJson().templates as { templateId: string; prompt: string }[]).map((t) =>
      TARGETS.includes(t.templateId) ? { ...t, prompt: `${t.prompt}（批量微调）` } : t,
    ),
  });
  const getPayload = await stubDetailRefineApis(
    page,
    () => ({ draft, report: passedReport, changeClass: "B", currentVersionLabel: "v1", nextVersionLabel: "v2" }),
    () => ({ status: 200, body: { packId: `${BASE}@v2`, changeClass: "B", versionLabel: "v2" } }),
  );

  await page.goto(`/admin/packs/${BASE}`);
  const section = page.getByTestId("题目列表分区");
  // 框选两道题：均为选中态共存（多选）
  await section.getByTestId(`题目选中按钮-${TARGETS[0]}`).click();
  await section.getByTestId(`题目选中按钮-${TARGETS[1]}`).click();
  await expect(section.getByTestId(`题目选中按钮-${TARGETS[0]}`)).toHaveAttribute("aria-pressed", "true");
  await expect(section.getByTestId(`题目选中按钮-${TARGETS[1]}`)).toHaveAttribute("aria-pressed", "true");
  // 面板明示批量目标数量
  await expect(page.getByTestId("元素微调目标")).toContainText("× 2");

  await page.getByTestId("修改意图").fill("这批题的提示统一更口语化");
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("改动分类提示")).toContainText("B 类改动");
  await page.getByTestId("确认生效").click();
  await expect(page.getByTestId("微调生效反馈")).toContainText("B 类改动");
  expect(getPayload()).toMatchObject({ packId: BASE, targetTemplateIds: TARGETS });
});
