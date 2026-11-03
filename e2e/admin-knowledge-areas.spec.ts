import { test, expect, type Page, type Route } from "@playwright/test";
import { presetLoginState, collectConsoleProblems } from "./helpers";

// 知识点词表管理页（issue #79 / spec #75，ADR 0010；#83 补被引用视图与禁删）：离线 route-mock
// 覆盖列表展示、创建、编辑、启停与删除交互；权限两跳照 admin-whitelist.spec.ts 的 mock 模式
// （教师 + 双权限点），/api/admin/knowledge-areas* 用内存状态回放（写操作改状态后重读可见）。
// 鉴权 401 / 403（无双权限点被拦）与归一校验在服务层单测断言（knowledge-area-admin-service.test.ts），
// 不在此重复（预期 4xx 响应会触发浏览器 console error，与 console 卫生断言冲突，照 admin-whitelist 口径）；
// #83 禁删同理：服务层拒绝路径（in_use → 400）在服务层单测断言，e2e 断言界面第一道防线
// （被引用条目删除按钮禁用 + 被引用域包列表可见）。

interface KnowledgeAreaEntry {
  id: string;
  name: string;
  description: string;
  active: boolean;
  /** #83：引用该条目的域包名称列表（服务端 listKnowledgeAreas 合并被引用视图） */
  referencedBy: string[];
}

/** /api/admin/knowledge-areas* 离线桩：GET 回放内存状态；POST/PUT/PATCH/DELETE 记录载荷并更新状态 */
async function mockKnowledgeAreaApi(page: Page) {
  const state = { entries: [
    // ka-1 被两个引用形态域包引用（#83 被引用视图素材）；ka-2 未被引用（删除/编辑路径素材）
    { id: "ka-1", name: "单表查询与投影", description: "SELECT 列投影", active: true, referencedBy: ["员工薪酬", "图书馆借阅"] },
    { id: "ka-2", name: "子查询", description: "", active: false, referencedBy: [] },
  ] as KnowledgeAreaEntry[] };
  const calls = { post: [] as unknown[], put: [] as unknown[], patch: [] as unknown[] };
  let nextId = 100;

  // glob 的 * 不跨 /：集合与单条（/api/admin/knowledge-areas/:id）分别注册，共用同一处理器
  const handler = async (route: Route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").pop();

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: state.entries }),
      });
      return;
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as { name: string; description: string };
      calls.post.push(body);
      const entry = { id: `ka-${nextId++}`, name: body.name, description: body.description, active: true, referencedBy: [] };
      state.entries = [...state.entries, entry].sort((a, b) => a.name.localeCompare(b.name));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: entry.id }) });
      return;
    }
    const target = state.entries.find((entry) => entry.id === id);
    if (!target) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "知识点条目不存在" }) });
      return;
    }
    if (method === "PUT") {
      const body = route.request().postDataJSON() as { name: string; description: string };
      calls.put.push({ id, ...body });
      target.name = body.name;
      target.description = body.description;
      state.entries = [...state.entries].sort((a, b) => a.name.localeCompare(b.name));
    } else if (method === "PATCH") {
      const body = route.request().postDataJSON() as { active: boolean };
      calls.patch.push({ id, ...body });
      target.active = body.active;
    } else if (method === "DELETE") {
      state.entries = state.entries.filter((entry) => entry.id !== id);
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  };
  await page.route("**/api/admin/knowledge-areas", handler);
  await page.route("**/api/admin/knowledge-areas/*", handler);
  return calls;
}

/** mock 当前用户（e2e-user）的教师权限（照 admin-whitelist.spec.ts 模式；默认挂双权限点） */
async function mockTeacherPermissions(page: Page, permissions: string[] = ["访问后台", "知识点词表管理"]) {
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
      body: JSON.stringify(permissions.map((permission) => ({ role: "教师", permission, created_at: "2026-01-01" }))),
    });
  });
}

// console 卫生（用户指令加严）：全用例期间页面不得出现 console.error/warning 或未捕获异常
let consoleProblems: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  await presetLoginState(page);
  await mockTeacherPermissions(page);
});
test.afterEach(() => {
  expect(consoleProblems, `console 卫生违例：\n${consoleProblems.join("\n")}`).toEqual([]);
});

test("列表展示：全量条目含停用态与描述，导航归属域包管理组", async ({ page }) => {
  await mockKnowledgeAreaApi(page);
  await page.goto("/admin/packs/vocab");

  await expect(page.getByTestId("知识点词表管理")).toBeVisible();
  await expect(page.getByTestId("词表行")).toHaveCount(2);
  const row = page.getByTestId("词表行-子查询");
  await expect(row).toContainText("子查询");
  await expect(row).toContainText("已停用");
  await expect(page.getByTestId("词表行-单表查询与投影")).toContainText("SELECT 列投影");
  await expect(page.getByTestId("词表统计")).toContainText("共 2 个知识点");
  await expect(page.getByTestId("后台侧边导航").getByRole("link", { name: "知识点词表" })).toHaveAttribute("aria-current", "page");
});

test("被引用视图（#83）：条目显示被引用域包数量与名单，未被引用条目无被引用徽标", async ({ page }) => {
  await mockKnowledgeAreaApi(page);
  await page.goto("/admin/packs/vocab");

  const badge = page.getByTestId("词表引用-单表查询与投影");
  await expect(badge).toContainText("被 2 个域包引用");
  await expect(badge).toHaveAttribute("title", "被以下域包引用：员工薪酬、图书馆借阅");
  // 未被引用条目不渲染被引用徽标（降噪）
  await expect(page.getByTestId("词表引用-子查询")).toHaveCount(0);
});

test("被引用条目禁删（#83）：删除按钮禁用且提示只能停用，未被引用条目删除可用", async ({ page }) => {
  await mockKnowledgeAreaApi(page);
  await page.goto("/admin/packs/vocab");

  const referencedDelete = page.getByTestId("词表行-单表查询与投影").getByRole("button", { name: "删除" });
  await expect(referencedDelete).toBeDisabled();
  await expect(referencedDelete).toHaveAttribute("title", "已被域包引用，不能删除（只能停用）");
  // 停用入口对被引用条目仍开放（ADR 0010：停用不阻断既有引用）
  await expect(page.getByTestId("词表行-单表查询与投影").getByRole("button", { name: "停用" })).toBeEnabled();
  await expect(page.getByTestId("词表行-子查询").getByRole("button", { name: "删除" })).toBeEnabled();
});

test("创建条目：填名称与描述后 POST，成功后列表出现新条目", async ({ page }) => {
  const calls = await mockKnowledgeAreaApi(page);
  await page.goto("/admin/packs/vocab");
  await expect(page.getByTestId("词表行")).toHaveCount(2);

  await page.getByTestId("新增名称输入框").fill("日期函数");
  await page.getByTestId("新增描述输入框").fill("日期相关函数使用");
  await page.getByTestId("新增条目").click();

  await expect(page.getByTestId("词表提示")).toContainText("已创建");
  expect(calls.post).toEqual([{ name: "日期函数", description: "日期相关函数使用" }]);
  await expect(page.getByTestId("词表行-日期函数")).toContainText("启用中");
  await expect(page.getByTestId("词表统计")).toContainText("共 3 个知识点");
});

test("编辑条目：改名称与描述后 PUT 载荷正确，保存后展示最新值", async ({ page }) => {
  const calls = await mockKnowledgeAreaApi(page);
  await page.goto("/admin/packs/vocab");
  await expect(page.getByTestId("词表行")).toHaveCount(2);

  await page.getByTestId("词表行-单表查询与投影").getByRole("button", { name: "编辑" }).click();
  const nameInput = page.getByTestId("编辑名称输入框");
  const descriptionInput = page.getByTestId("编辑描述输入框");
  await expect(nameInput).toHaveValue("单表查询与投影");
  await nameInput.fill("单表查询");
  await descriptionInput.fill("投影与筛选基础");
  await page.getByTestId("保存编辑").click();

  await expect(page.getByTestId("词表提示")).toContainText("已保存");
  expect(calls.put).toEqual([{ id: "ka-1", name: "单表查询", description: "投影与筛选基础" }]);
  await expect(page.getByTestId("词表行-单表查询")).toContainText("投影与筛选基础");
  await expect(page.getByTestId("词表行-单表查询与投影")).toHaveCount(0);
});

test("启停切换：启用停用条目 / 停用启用条目，PATCH 载荷与状态徽标随动", async ({ page }) => {
  const calls = await mockKnowledgeAreaApi(page);
  await page.goto("/admin/packs/vocab");

  await page.getByTestId("词表行-子查询").getByRole("button", { name: "启用" }).click();
  await expect(page.getByTestId("词表提示")).toContainText("已启用");
  await expect(page.getByTestId("词表行-子查询")).toContainText("启用中");

  await page.getByTestId("词表行-单表查询与投影").getByRole("button", { name: "停用" }).click();
  await expect(page.getByTestId("词表提示")).toContainText("已停用");
  await expect(page.getByTestId("词表行-单表查询与投影")).toContainText("已停用");

  expect(calls.patch).toEqual([{ id: "ka-2", active: true }, { id: "ka-1", active: false }]);
});

test("删除条目：物理删除后行消失", async ({ page }) => {
  await mockKnowledgeAreaApi(page);
  await page.goto("/admin/packs/vocab");

  await page.getByTestId("词表行-子查询").getByRole("button", { name: "删除" }).click();

  await expect(page.getByTestId("词表提示")).toContainText("已删除");
  await expect(page.getByTestId("词表行-子查询")).toHaveCount(0);
  await expect(page.getByTestId("词表统计")).toContainText("共 1 个知识点");
});
