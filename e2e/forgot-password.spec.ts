// 忘记密码 E2E（issue #26）：外部依赖（Supabase auth 网络层）一律 route mock，离线可跑。
// 覆盖：登录页入口 → 请求页（防枚举统一提示）→ 模拟邮件链接落回调 → 新密码页改密成功；
// 弱密码被拒；两次不一致被拒。
import { expect, test, type Page } from "@playwright/test";


/** 结构合法的假 JWT（同登录 spec：setSession/updateUser 会校验 JWT 结构） */
function fakeJwt(): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600, email: "zhang@cuc.edu.cn", aud: "authenticated" }),
    "e2e-signature-",
  ].join(".");
}

const sessionPayload = () => ({
  access_token: fakeJwt(),
  refresh_token: "e2e-rt",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "u1", email: "zhang@cuc.edu.cn", aud: "authenticated" },
});

/** mock Supabase auth 网络层：recover（请求重置）、token?grant_type=pkce（回调换登录态）、user（改密）、logout（登出） */
async function mockSupabaseAuthLayer(page: Page, options: { updateFails?: boolean } = {}) {
  const requestLog: { endpoint: string; payload?: unknown }[] = [];
  await page.route("**/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split("/").pop() + (url.searchParams.get("grant_type") ? `?${url.searchParams.get("grant_type")}` : "");
    requestLog.push({ endpoint, payload: route.request().postDataJSON?.() });
    if (url.pathname.endsWith("/recover")) {
      await route.fulfill({ status: 200, json: {} });
    } else if (url.pathname.endsWith("/token")) {
      // PKCE 换登录态：redirectType 由客户端本地 verifier 决定，无需服务端参与
      await route.fulfill({ status: 200, json: sessionPayload() });
    } else if (url.pathname.endsWith("/user") && route.request().method() === "PUT") {
      await route.fulfill(
        options.updateFails
          ? { status: 400, json: { error_code: "weak_password", msg: "密码强度不足" } }
          : { status: 200, json: sessionPayload().user },
      );
    } else if (url.pathname.endsWith("/logout")) {
      await route.fulfill({ status: 204, body: "" });
    } else {
      await route.fulfill({ status: 200, json: {} });
    }
  });
  return requestLog;
}

test.describe("忘记密码", () => {
  test("登录页有入口，请求页防枚举统一提示", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("忘记密码入口").click();
    await expect(page).toHaveURL(/\/forgot-password/);

    // 空邮箱：必填提示，不发请求
    let requestCount = 0;
    // recover 请求带 ?redirect_to= 查询串，glob 须以 * 收尾
    await page.route("**/auth/v1/recover*", (route) => { requestCount += 1; return route.fulfill({ status: 200, json: {} }); });
    await page.getByTestId("发送重置邮件按钮").click();
    await expect(page.getByTestId("错误-邮箱")).toHaveText("邮箱必填");
    expect(requestCount).toBe(0);

    // 格式不正确：立即提示
    await page.getByTestId("邮箱输入").fill("not-an-email");
    await page.getByTestId("发送重置邮件按钮").click();
    await expect(page.getByTestId("错误-邮箱")).toHaveText("邮箱格式不正确");
    expect(requestCount).toBe(0);

    // 合法邮箱：发出请求，展示统一提示（不区分邮箱是否存在）
    await page.getByTestId("邮箱输入").fill("zhang@cuc.edu.cn");
    await page.getByTestId("发送重置邮件按钮").click();
    await expect(page.getByTestId("重置请求已提交")).toBeVisible();
    await expect(page.getByTestId("重置请求已提交")).toContainText("若该邮箱已注册");
    expect(requestCount).toBe(1);
  });

  test("不存在的邮箱也返回统一提示（防枚举）", async ({ page }) => {
    await mockSupabaseAuthLayer(page);
    await page.goto("/forgot-password");
    await page.getByTestId("邮箱输入").fill("nobody@cuc.edu.cn");
    await page.getByTestId("发送重置邮件按钮").click();
    await expect(page.getByTestId("重置请求已提交")).toContainText("若该邮箱已注册");
  });

  test("全流程：请求 → 模拟邮件链接回调 → 新密码改密成功回登录", async ({ page }) => {
    const requestLog = await mockSupabaseAuthLayer(page);

    // ① 请求重置（真实调用 resetPasswordForEmail：PKCE verifier + recovery 标记落 localStorage）
    await page.goto("/forgot-password");
    await page.getByTestId("邮箱输入").fill("zhang@cuc.edu.cn");
    await page.getByTestId("发送重置邮件按钮").click();
    await expect(page.getByTestId("重置请求已提交")).toBeVisible();

    // ② 模拟用户点击邮件链接：落回调页（?code=…），换登录态后按 recovery 转入新密码页
    await page.goto("/auth/callback?code=e2e-recovery-code");
    await expect(page).toHaveURL(/\/reset-password/, { timeout: 15000 });
    await expect(page.getByTestId("重置密码按钮")).toBeVisible();

    // ③ 改密：两次不一致先被拒，再以合法新密码提交成功
    await page.getByTestId("新密码输入").fill("news2026pass");
    await page.getByTestId("确认密码输入").fill("news2027pass");
    await page.getByTestId("重置密码按钮").click();
    await expect(page.getByTestId("密码错误")).toHaveText("两次输入的密码不一致");

    await page.getByTestId("新密码输入").fill("news2026pass");
    await page.getByTestId("确认密码输入").fill("news2026pass");
    await page.getByTestId("重置密码按钮").click();

    await expect(page.getByTestId("重置成功")).toBeVisible({ timeout: 15000 });
    // updateUser 收到新密码（载荷还会带 code_challenge 等字段，只断言密码）
    const updateRequest = requestLog.find((r) => r.endpoint === "user");
    expect(updateRequest?.payload).toMatchObject({ password: "news2026pass" });

    // 成功后回登录页
    await page.getByTestId("去登录").click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("登录按钮")).toBeVisible();
  });

  test("弱密码被拒：不足 8 位与纯数字均不发起改密", async ({ page }) => {
    const requestLog = await mockSupabaseAuthLayer(page);
    await page.goto("/forgot-password");
    await page.getByTestId("邮箱输入").fill("zhang@cuc.edu.cn");
    await page.getByTestId("发送重置邮件按钮").click();
    await expect(page.getByTestId("重置请求已提交")).toBeVisible();
    await page.goto("/auth/callback?code=e2e-recovery-code");
    await expect(page).toHaveURL(/\/reset-password/, { timeout: 15000 });

    await page.getByTestId("新密码输入").fill("ab12");
    await page.getByTestId("确认密码输入").fill("ab12");
    await page.getByTestId("重置密码按钮").click();
    await expect(page.getByTestId("密码错误")).toHaveText("密码至少 8 位");

    await page.getByTestId("新密码输入").fill("12345678");
    await page.getByTestId("确认密码输入").fill("12345678");
    await page.getByTestId("重置密码按钮").click();
    await expect(page.getByTestId("密码错误")).toHaveText("密码须同时包含字母与数字");

    expect(requestLog.some((r) => r.endpoint === "user")).toBe(false);
  });

  test("无登录态直达新密码页：提示链接无效", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByTestId("重置链接无效")).toBeVisible();
  });
});
