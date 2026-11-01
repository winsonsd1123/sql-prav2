import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub } from "./helpers";
import { mkCloudPackJson } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";
import type { GateReport } from "../src/kernel/domain-pack-gate";

// 域包微调端到端（票 #62 / ADR-0009）：教师发起微调 → 验证报告 + B 类改动明示（将产生
// library-loan@v2）→ 确认生效 → 版本历史区块渲染 → 学生端进行中会话（旧 packId）仍加载
// 旧版本题面、切换胶囊（展示注册表只留最新版）进入新版本。LLM 打桩沿用 #60 管理页 spec
// 的浏览器层 page.route 设计（页面自身 fetch 可拦截，服务端出站与生产零改动）。
// B 类改动的服务端落库（历史表写入/当前行改写）不在浏览器层发生，用内存行集模拟
// 「确认生效后云端的新状态」：apply 桩原子地改写资产行 + 追加历史行。

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

/** 管理页同页其余区块的 API 桩（与 domain-pack-admin-page.spec 同款） */
async function mockSiblingBlocks(page: Page) {
  await page.route("**/api/admin/pack-exposure", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packIds: [] }) });
  });
  await page.route("**/api/admin/domain-packs/practice-config", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packs: [] }) });
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

test("B 类微调→确认产生 v2：学生旧会话钉旧版题面，切换胶囊进入新版", async ({ page }) => {
  await mockTeacherPermissions(page);
  await mockSiblingBlocks(page);
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

  // —— 教师端：发起微调 → 报告 + B 类明示 → 确认生效 ——
  await page.goto("/admin/packs");
  await page.getByTestId("微调目标域包").selectOption(BASE);
  await page.getByTestId("修改意图").fill("把题目模板的题面写得更贴合借阅业务");
  await page.getByTestId("微调SQL样例").fill("SELECT 姓名 FROM 读者 JOIN 借阅 ON …");
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("微调等待提示")).toContainText("正在生成");
  await expect(page.getByTestId("改动分类提示")).toContainText("B 类改动");
  await expect(page.getByTestId("改动分类提示")).toContainText("v2");
  await expect(page.getByTestId("微调报告")).toContainText("验证通过");
  await page.getByTestId("确认生效").click();
  await expect(page.getByTestId("微调生效反馈")).toContainText("library-loan@v2");

  // —— 版本历史区块：v2 置顶标「当前」，v1 标历史 ——
  await page.getByTestId("版本历史目标域包").selectOption(BASE);
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
  await mockSiblingBlocks(page);
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

  await page.goto("/admin/packs");
  await page.getByTestId("微调目标域包").selectOption("library-loan");
  await page.getByTestId("修改意图").fill("给难度档位补充样例");
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("微调失败提示")).toContainText("LLM 网络请求失败");
  await expect(page.getByTestId("修改意图")).toHaveValue("给难度档位补充样例");
  // 重试 → 第二次成功进入报告态（A 类：即时生效、packId 不变）
  await page.getByTestId("发起微调").click();
  await expect(page.getByTestId("改动分类提示")).toContainText("A 类改动");
  await expect(page.getByTestId("改动分类提示")).toContainText("packId 不变");
});
