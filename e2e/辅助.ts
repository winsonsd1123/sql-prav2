// E2E 共享辅助：登录态预置（issue #25）。
// 强制登录后，既有演练场 spec 需要在导航前预置一份未过期的 Supabase 会话
// （浏览器客户端固定存储键「演练场-supabase-auth」；auth-js 2.118 存扁平 Session 对象，
//  顶层须含 access_token/refresh_token/expires_at，getSession 离线可读）。
import type { Page } from "@playwright/test";

export async function 预置登录态(page: Page) {
  await page.addInitScript(() => {
    const 会话 = {
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "e2e-user", email: "e2e@cuc.edu.cn", aud: "authenticated" },
    };
    localStorage.setItem("演练场-supabase-auth", JSON.stringify(会话));
  });
}
