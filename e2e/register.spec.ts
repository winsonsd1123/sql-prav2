// 注册纵切 E2E（issue #23）：外部依赖（自有 /api 路由、Supabase 网络）一律路由拦截 mock，离线可跑。
import { expect, test, type Page } from "@playwright/test";

async function openRegisterPage(page: Page) {
  await page.goto("/register");
  await expect(page.getByTestId("注册按钮")).toBeVisible();
}

/** 路由匹配谓词：中文路径在浏览器里是百分号编码的，glob 匹配会落空，改按解码后的 pathname 判等 */
function matchPath(path: string) {
  return (url: URL) => url.pathname === path;
}

/** mock 网络层：白名单（关闭 + cuc.edu.cn）、注册校验、Supabase signUp（API 路由段用 ASCII：中文段在 next start 下 404） */
async function mockAllGreenNetwork(page: Page, options?: { registerCheck?: object; signUp?: object }) {
  await page.route(matchPath("/api/whitelist"), (route) =>
    route.fulfill({ json: { allowAnyDomain: false, domainList: ["cuc.edu.cn"] } }),
  );
  await page.route(matchPath("/api/register-check"), (route) =>
    route.fulfill({
      status: 200,
      json: options?.registerCheck ?? { registrable: true, errors: {} },
    }),
  );
  // signUp 请求带 ?redirect_to= 查询串，glob 须以 ** 收尾。
  // 载荷按 supabase-js 的解析约定：成功 = 200 + 用户对象（session 为 null 表示待邮箱验证）；
  // 失败 = 4xx + { code, msg }（客户端据此构造 AuthError.message）。
  await page.route("**/auth/v1/signup**", (route) =>
    route.fulfill(
      options?.signUp ?? { status: 200, json: { id: "u1", aud: "authenticated", email: "zhang@cuc.edu.cn" } },
    ),
  );
}

// testid（中文）→ 表单值；字段键已英文化（studentId 等），testid 保持既有中文选择器
async function fillForm(page: Page, overrides: Record<string, string> = {}) {
  const values = {
    "学号": "2022110001",
    "姓名": "张三",
    "昵称": "小张",
    "邮箱": "zhang@cuc.edu.cn",
    "密码": "play2026",
    ...overrides,
  };
  for (const testid of Object.keys(values) as (keyof typeof values)[]) {
    await page.getByTestId(`${testid}输入`).fill(values[testid]);
  }
}

test.beforeEach(async ({ page }) => {
  await mockAllGreenNetwork(page);
});

test.describe("注册表单校验", () => {
  test("空表单提交：逐字段给出中文错误提示", async ({ page }) => {
    await openRegisterPage(page);
    await page.getByTestId("注册按钮").click();
    await expect(page.getByTestId("错误-学号")).toHaveText("学号必填");
    await expect(page.getByTestId("错误-姓名")).toHaveText("姓名必填");
    await expect(page.getByTestId("错误-昵称")).toHaveText("昵称必填");
    await expect(page.getByTestId("错误-邮箱")).toHaveText("邮箱格式不正确");
    await expect(page.getByTestId("错误-密码")).toHaveText("密码至少 8 位");
  });

  test("弱密码与非法学号：即时提示", async ({ page }) => {
    await openRegisterPage(page);
    await fillForm(page, { "密码": "12345678", "学号": "2022 110" });
    await expect(page.getByTestId("错误-密码")).toContainText("字母与数字");
    await expect(page.getByTestId("错误-学号")).toContainText("4-20 位");
  });
});

test.describe("白名单拦截", () => {
  test("域名不符：即时提示且不发注册校验请求", async ({ page }) => {
    let checkRequestCount = 0;
    await page.route(matchPath("/api/register-check"), async (route) => {
      checkRequestCount += 1;
      await route.fulfill({ status: 200, json: { registrable: true, errors: {} } });
    });

    await openRegisterPage(page);
    await fillForm(page, { "邮箱": "zhang@gmail.com" });
    // 即时提示（输入后不等提交）
    await expect(page.getByTestId("错误-邮箱")).toHaveText("邮箱域名不在白名单内");
    await page.getByTestId("注册按钮").click();
    expect(checkRequestCount).toBe(0);
  });

  test("服务端双保险：前端放过后服务端仍拦截并展示错误", async ({ page }) => {
    await page.route(matchPath("/api/register-check"), (route) =>
      route.fulfill({
        status: 422,
        json: { registrable: false, errors: { studentId: "该学号已注册" } },
      }),
    );
    await openRegisterPage(page);
    await fillForm(page);
    await page.getByTestId("注册按钮").click();
    await expect(page.getByTestId("错误-学号")).toHaveText("该学号已注册");
    await expect(page.getByTestId("验证邮件提示")).toHaveCount(0);
  });
});

test.describe("提交与提示", () => {
  test("提交成功：提示查收验证邮件", async ({ page }) => {
    await openRegisterPage(page);
    await fillForm(page);
    await page.getByTestId("注册按钮").click();
    await expect(page.getByTestId("验证邮件提示")).toBeVisible();
    await expect(page.getByTestId("验证邮件提示")).toContainText("zhang@cuc.edu.cn");
    await expect(page.getByTestId("验证邮件提示")).toContainText("验证邮件");
  });

  test("signUp 报错：展示提交错误，不出现成功提示", async ({ page }) => {
    await mockAllGreenNetwork(page, { signUp: { status: 422, json: { code: 422, msg: "User already registered" } } });
    await openRegisterPage(page);
    await fillForm(page);
    await page.getByTestId("注册按钮").click();
    await expect(page.getByTestId("提交错误")).toContainText("registered");
    await expect(page.getByTestId("验证邮件提示")).toHaveCount(0);
  });
});

test.describe("邮箱验证回调", () => {
  test("code 换登录态成功：展示成功态", async ({ page }) => {
    // PKCE 换登录态端点（supabase-js exchangeCodeForSession）
    await page.route("**/auth/v1/token**", (route) =>
      route.fulfill({ status: 200, json: { access_token: "at", token_type: "bearer", expires_in: 3600, refresh_token: "rt", user: { id: "u1" } } }),
    );
    // 预置 PKCE code verifier（注册发起时由 auth-js 写入；跨页面场景在此直接种下）
    await page.addInitScript(() =>
      localStorage.setItem("演练场-supabase-auth-code-verifier", JSON.stringify("verifier-1")),
    );
    await page.goto("/auth/callback?code=pkce-code-1");
    await expect(page.getByTestId("验证成功")).toBeVisible();
  });

  test("缺 code：展示失败态", async ({ page }) => {
    await page.goto("/auth/callback");
    await expect(page.getByTestId("验证失败")).toBeVisible();
  });
});
