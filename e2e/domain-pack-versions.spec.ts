import { test, expect, type Page } from "@playwright/test";
import { presetLoginState, collectConsoleProblems, createDomainPackAssetStub, createDomainPackVersionHistoryStub, chooseSelectOption } from "./helpers";
import { mkCloudPackJson } from "../src/kernel/__tests__/fixtures/cloud-domain-pack";

// 域包版本历史独立页（票 #68 / spec #64）：/admin/packs/versions 支持 ?packId= 预选基础名
// 自动查询，参数缺失回退页内选择器。版本表口径不变（当前·新会话使用 | 历史·旧会话钉住）。
// 旧单页 refine 流程内的版本历史断言（domain-pack-refine.spec）由 #67 处置，此处不重复迁移。

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

/** 页面数据桩：云端一个 library-loan@v2 资产 + 版本历史表空（查询走 API 桩） */
async function attachPageStubs(page: Page) {
  const assetStub = createDomainPackAssetStub();
  assetStub.rows.push({
    pack_id: "library-loan@v2",
    asset: mkCloudPackJson({ packId: "library-loan@v2", name: "图书馆借阅" }),
  });
  await assetStub.attach(page);
  await createDomainPackVersionHistoryStub().attach(page);
}

/** 版本历史查询 API 桩：当前 v2 + 历史 v1（口径同 domain-pack-refine.spec） */
async function mockVersionsApi(page: Page) {
  await page.route("**/api/admin/domain-packs/versions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: [
          { packId: "library-loan@v2", versionLabel: "v2", name: "图书馆借阅", createdAt: "2026-11-01", isCurrent: true },
          { packId: "library-loan", versionLabel: "v1", name: "图书馆借阅", createdAt: "2026-10-01", isCurrent: false },
        ],
      }),
    });
  });
}

test("?packId= 预选基础名：直接访问即自动查询并展示版本表", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);

  await page.goto("/admin/packs/versions?packId=library-loan");
  // 无需手动选择：版本表自动出现，选择器已选中预选基础名
  await expect(page.getByTestId("版本历史目标域包")).toContainText("（library-loan）");
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
  await expect(page.getByTestId("版本历史列表")).toContainText("历史（旧会话钉住）");
});

test("无 packId 参数：回退页内选择器，手动选择后查询成功", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);

  await page.goto("/admin/packs/versions");
  // 未选择目标前不展示版本表，选择器停在占位项
  await expect(page.getByTestId("版本历史目标域包")).toHaveText("请选择域包");
  await expect(page.getByTestId("版本历史列表")).toHaveCount(0);
  // 页内选择器兜底：选中后查询，既有口径（当前/历史）不变
  await chooseSelectOption(page, "版本历史目标域包", "（library-loan）");
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
  await expect(page.getByTestId("版本历史列表")).toContainText("历史（旧会话钉住）");
});

test("下拉键盘可达（票 #97）：回车展开、方向键移动高亮、回车确认并查询，焦点回到触发器", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);

  await page.goto("/admin/packs/versions");
  const trigger = page.getByTestId("版本历史目标域包");
  await expect(trigger).toHaveText("请选择域包");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const highlighted = page.locator('[role="option"][data-highlighted]');
  await expect(highlighted).not.toHaveText("请选择域包");
  const label = (await highlighted.textContent()) ?? "";
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toHaveText(label);
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
});

// —— 票 #86：版本完整内容查看（版本行「查看内容」→ 版本内容视图页复用详情展示组件）——

/** 版本内容 API 桩：v1（历史，旧字符串清单形态——无 knowledgeAreaRefIds）与 v2（当前） */
async function mockVersionContentApi(page: Page) {
  await page.route("**/api/admin/domain-packs/versions/content*", async (route) => {
    const packId = new URL(route.request().url()).searchParams.get("packId");
    if (packId === "library-loan") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asset: mkCloudPackJson({ packId: "library-loan", name: "图书馆借阅" }),
          versionLabel: "v1",
          isCurrent: false,
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asset: mkCloudPackJson({ packId: "library-loan@v2", name: "图书馆借阅" }),
          versionLabel: "v2",
          isCurrent: true,
        }),
      });
    }
  });
}

test("版本行「查看内容」：历史版本全分区渲染（旧字符串清单形态兼容）", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);
  await mockVersionContentApi(page);

  await page.goto("/admin/packs/versions?packId=library-loan");
  // 历史版本行（v1）入口携带完整 packId 跳版本内容视图页
  await page.getByTestId("查看内容-library-loan").click();
  await expect(page).toHaveURL(/\/admin\/packs\/versions\/view\?packId=library-loan$/);
  // 历史版本标识：与版本列表同口径（历史 · 旧会话钉住）
  await expect(page.getByTestId("版本内容标识")).toContainText("历史");
  // 复用详情展示组件：四分区全量渲染（库骨架 / 知识点清单 / 题目列表 / 难度档位与演练配置）
  await expect(page.getByTestId("域包详情-图书馆借阅")).toBeVisible();
  await expect(page.getByTestId("库骨架分区").getByTestId(/^骨架表-/).first()).toBeVisible();
  await expect(page.getByTestId("知识点条目-0")).toContainText("1. ");
  await expect(page.getByTestId("题目列表分区").getByTestId(/^题目概要行-/).first()).toBeVisible();
  await expect(page.getByTestId("难度档位分区").getByTestId("难度档位-1")).toBeVisible();
  await expect(page.getByTestId("演练配置摘要")).toContainText("总题数：");
});

test("当前版本标识：视图页标「当前」，版本列表行同口径", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);
  await mockVersionContentApi(page);

  await page.goto("/admin/packs/versions?packId=library-loan");
  await expect(page.getByTestId("版本历史列表")).toContainText("当前（新会话使用）");
  // 当前版本行（v2）入口：视图页明确标识当前版本（新会话使用）
  await page.getByTestId("查看内容-library-loan@v2").click();
  await expect(page).toHaveURL(/packId=library-loan%40v2$/);
  await expect(page.getByTestId("版本内容标识")).toContainText("当前版本（新会话使用）");
  await expect(page.getByTestId("域包详情-图书馆借阅")).toBeVisible();
});

// —— 票 #88：版本轻量 diff（历史版本 → 当前版本基准：分类结论 + 变更区块清单）——

/** diff 场景内容 API 桩：v1（历史）与 v2（当前）存在真实内容差异——
 *  题目模板 cloud-tpl-01 题面改、知识点「综合应用」换成「窗口函数」、表「学生」行数改 */
async function mockVersionDiffApi(page: Page) {
  const currentJson = mkCloudPackJson({ packId: "library-loan@v2", name: "图书馆借阅" });
  const historicalJson = mkCloudPackJson({
    packId: "library-loan",
    name: "图书馆借阅",
    schemaSkeleton: (currentJson.schemaSkeleton as Record<string, unknown>[]).map((t, i) =>
      i === 0 ? { ...t, rowCount: 15 } : t,
    ),
    templates: (currentJson.templates as Record<string, unknown>[]).map((t, i) =>
      i === 0 ? { ...t, prompt: "旧题面：单表投影练习。" } : t,
    ),
    knowledgeAreas: (currentJson.knowledgeAreas as string[]).slice(0, 6).concat("窗口函数"),
  });
  await page.route("**/api/admin/domain-packs/versions/content*", async (route) => {
    const packId = new URL(route.request().url()).searchParams.get("packId");
    const isCurrent = packId === "library-loan@v2";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        isCurrent
          ? { asset: currentJson, versionLabel: "v2", isCurrent: true }
          : { asset: historicalJson, versionLabel: "v1", isCurrent: false },
      ),
    });
  });
}

test("历史版本视图页呈现轻量 diff：分类结论 + 变更区块清单", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);
  await mockVersionDiffApi(page);

  await page.goto("/admin/packs/versions/view?packId=library-loan");
  // 分类结论透传版本分类器：种子内容（表 / 知识点 / 模板）有变 → B 类
  await expect(page.getByTestId("版本diff区块")).toBeVisible();
  await expect(page.getByTestId("版本diff区块")).toContainText("v1 → 当前版本 v2");
  await expect(page.getByTestId("版本diff结论")).toContainText("B 类改动");
  // 变更区块清单：表 / 知识点 / 题目模板粒度的增删改（不做逐字段高亮）
  await expect(page.getByTestId("diff区块-table-学生")).toContainText("修改");
  await expect(page.getByTestId("diff区块-knowledgeArea-综合应用")).toContainText("新增");
  await expect(page.getByTestId("diff区块-knowledgeArea-窗口函数")).toContainText("删除");
  await expect(page.getByTestId("diff区块-template-cloud-tpl-01")).toContainText("修改");
});

test("当前版本视图页不呈现 diff 区块（vs 自身恒为无差异）", async ({ page }) => {
  await mockTeacherPermissions(page);
  await attachPageStubs(page);
  await mockVersionsApi(page);
  await mockVersionDiffApi(page);

  await page.goto("/admin/packs/versions/view?packId=library-loan@v2");
  await expect(page.getByTestId("版本内容标识")).toContainText("当前版本（新会话使用）");
  await expect(page.getByTestId("版本diff区块")).toHaveCount(0);
});
