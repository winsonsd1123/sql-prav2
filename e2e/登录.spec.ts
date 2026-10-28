// 登录与强制登录 E2E（issue #25）：外部依赖（阿里验证码组件、/api/auth/login）一律 mock，离线可跑。
// 验证码接缝：登录表单在 window.initAliyunCaptcha 已存在时直接使用（不加载外网脚本），
// 故 addInitScript 注入 stub 即可替换整个验证码组件。
import { expect, test, type Page } from "@playwright/test";

/** 验证码 stub 形态：记录 initAliyunCaptcha 收到的配置，并按需把「点登录按钮」接到回调 */
async function 注入验证码(page: Page, 行为: "点击即通过" | "点击无反应" = "点击即通过") {
  await page.addInitScript(([模式]) => {
    const w = window as unknown as Record<string, unknown>;
    type 验证码配置 = {
      button: string;
      captchaVerifyCallback: (票据: string) => Promise<{ captchaResult?: boolean }>;
    };
    w.__验证码配置 = null;
    w.__验证码回调结果 = [];
    w.initAliyunCaptcha = (原始配置: 验证码配置) => {
      const 原回调 = 原始配置.captchaVerifyCallback.bind(原始配置);
      const 配置 = {
        ...原始配置,
        // 包装回调以记录组件返回的 captchaResult（供「滑块刷新」断言）
        captchaVerifyCallback: async (...参数: [string]) => {
          const 结果 = await 原回调(...参数);
          (w.__验证码回调结果 as boolean[]).push(结果?.captchaResult ?? false);
          return 结果;
        },
      };
      w.__验证码配置 = 配置;
      if (模式 === "点击无反应") return;
      const 按钮 = document.querySelector(配置.button);
      按钮?.addEventListener("click", () => 配置.captchaVerifyCallback("e2e-验证票据"));
    };
  }, [行为]);
}

async function 打开登录页(page: Page) {
  await page.goto("/login");
  await expect(page.getByTestId("登录按钮")).toBeVisible();
}

function 匹配路径(路径: string) {
  return (url: URL) => decodeURIComponent(url.pathname) === 路径;
}

/** 结构合法的假 JWT（base64url 头.载荷.签名，exp 在未来）：auth-js 的 setSession 会校验 JWT 结构后才落会话 */
function 假JWT(声明: Record<string, unknown> = {}): string {
  const 编码 = (值: object) => btoa(JSON.stringify(值)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return [
    编码({ alg: "HS256", typ: "JWT" }),
    编码({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600, ...声明 }),
    // 签名段也须满足 auth-js 的 base64url 正则（长度 %4 ≠ 1），否则 setSession 报 invalid_jwt
    "e2e-signature-",
  ].join(".");
}

test.beforeEach(async ({ page }) => {
  await 注入验证码(page);
});

test.describe("强制登录", () => {
  test("未登录访问演练场：重定向到登录页", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("登录按钮")).toBeVisible();
  });

  test("已预置会话：直接进入演练场", async ({ page }) => {
    const { 预置登录态 } = await import("./辅助");
    await 预置登录态(page);
    await page.goto("/?seed=42");
    await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible();
  });
});

test.describe("登录流程", () => {
  test("学号登录成功：进入演练场", async ({ page }) => {
    page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 200)));
    page.on("response", (r) => { if (!r.url().includes("_next")) console.log("[res]", r.status(), r.url().slice(0, 120)); });
    let 登录载荷: Record<string, unknown> | null = null;
    // setSession/getSession 若触发令牌刷新或用户拉取，按 supabase-js 解析约定 mock（离线可跑）
    await page.route("**/auth/v1/**", (路由) =>
      路由.fulfill({
        status: 200,
        json: {
          access_token: "e2e-at",
          refresh_token: "e2e-rt",
          expires_in: 3600,
          token_type: "bearer",
          user: { id: "u1", email: "zhang@cuc.edu.cn", aud: "authenticated" },
        },
      }),
    );
    await page.route(匹配路径("/api/auth/login"), async (路由) => {
      登录载荷 = 路由.request().postDataJSON();
      await 路由.fulfill({
        status: 200,
        json: {
          会话: { access_token: 假JWT(), refresh_token: "rt", token_type: "bearer", expires_in: 3600 },
          用户: { id: "u1", email: "zhang@cuc.edu.cn" },
        },
      });
    });

    await 打开登录页(page);
    await page.getByTestId("标识输入").fill("2022110001");
    await page.getByTestId("密码输入").fill("play2026");
    await page.getByTestId("登录按钮").click();

    // 票据原样透传后端
    expect(登录载荷).toEqual({ 标识: "2022110001", 密码: "play2026", 验证票据: "e2e-验证票据" });
    try {
      await expect(page.getByRole("heading", { name: "SQL 演练场" })).toBeVisible({ timeout: 15000 });
    } catch (e) {
      console.log("[dbg] storage:", await page.evaluate(() => localStorage.getItem("演练场-supabase-auth")));
      throw e;
    }
  });

  test("登录失败：统一防枚举错误，停留登录页", async ({ page }) => {
    await page.route(匹配路径("/api/auth/login"), (路由) =>
      路由.fulfill({ status: 401, json: { 错误: "账号或密码不正确" } }),
    );

    await 打开登录页(page);
    await page.getByTestId("标识输入").fill("zhang@cuc.edu.cn");
    await page.getByTestId("密码输入").fill("wrong123");
    await page.getByTestId("登录按钮").click();

    await expect(page.getByTestId("提交错误")).toHaveText("账号或密码不正确");
    await expect(page).toHaveURL(/\/login/);
  });

  test("验证码未通过：显示错误并触发滑块刷新", async ({ page }) => {
    await page.route(匹配路径("/api/auth/login"), (路由) =>
      路由.fulfill({ status: 401, json: { 错误: "验证码未通过，请重试" } }),
    );

    await 打开登录页(page);
    await page.getByTestId("标识输入").fill("2022110001");
    await page.getByTestId("密码输入").fill("play2026");
    await page.getByTestId("登录按钮").click();

    await expect(page.getByTestId("提交错误")).toHaveText("验证码未通过，请重试");
    // 组件应收到 captchaResult=false（触发自动刷新滑块）
    const 已刷新 = await page.evaluate(
      () =>
        ((window as unknown as Record<string, unknown>).__验证码回调结果 as boolean[] | undefined)?.includes(
          false,
        ),
    );
    expect(已刷新).toBe(true);
  });

  test("验证码组件不可用（未通过）：登录按钮禁用、不发登录请求", async ({ page }) => {
    let 登录请求数 = 0;
    await page.route(匹配路径("/api/auth/login"), async (路由) => {
      登录请求数 += 1;
      await 路由.fulfill({ status: 200, json: {} });
    });

    // 不注入 stub：真实外网脚本在离线环境加载失败 → 验证码不可用，无降级路径
    await page.addInitScript(() => {
      delete window.initAliyunCaptcha;
    });
    await page.route("**/o.alicdn.com/**", (路由) => 路由.abort());
    await 打开登录页(page);

    await page.getByTestId("标识输入").fill("2022110001");
    await page.getByTestId("密码输入").fill("play2026");
    await expect(page.getByTestId("登录按钮")).toBeDisabled();
    await expect(page.getByTestId("验证码提示")).toContainText("验证码");
    expect(登录请求数).toBe(0);
  });
});
