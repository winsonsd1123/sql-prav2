// E2E 共享辅助：登录态预置（issue #25）。
// 强制登录后，既有演练场 spec 需要在导航前预置一份未过期的 Supabase 登录态
// （浏览器客户端固定存储键「演练场-supabase-auth」；auth-js 2.118 存扁平 Session 对象，
//  顶层须含 access_token/refresh_token/expires_at，getSession 离线可读）。
import type { Page } from "@playwright/test";

export async function 预置登录态(page: Page) {
  await page.addInitScript(() => {
    const 登录态 = {
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "e2e-user", email: "e2e@cuc.edu.cn", aud: "authenticated" },
    };
    localStorage.setItem("演练场-supabase-auth", JSON.stringify(登录态));
  });
}

// T6 · 进度上云（issue #28）：Supabase REST 进度表的云端桩。
// 拦截 /rest/v1/练习进度 的 GET（恢复拉取）与 POST（节流 upsert），
// 行集跨 page/context 共享（跨浏览器上下文恢复用例），离线可跑。

export interface 云端进度行 {
  用户id: string;
  种子: number;
  域包: string;
  进度: {
    已通过题号?: number[];
    已看提示?: Record<string, number>;
    已借助答案题号?: number[];
    尝试次数?: Record<string, number>;
    草稿?: Record<string, string>;
  };
}

export function 创建云端进度桩() {
  const 行集 = new Map<string, 云端进度行>();
  const 收到的写 = [] as 云端进度行[];
  const 键 = (r: { 用户id: string; 种子: number; 域包: string }) =>
    `${r.用户id}:${r.域包}:${r.种子}`;
  const 挂 = async (page: Page) => {
    // 表名为中文：URL 中被百分号编码，glob 不能直接匹配表名，先拦 /rest/v1 再按解码路径分流
    await page.route("**/rest/v1/**", async (route) => {
      const 请求 = route.request();
      if (!decodeURIComponent(请求.url()).includes("/rest/v1/练习进度")) return route.continue();
      if (请求.method() === "GET") {
        const url = decodeURIComponent(请求.url());
        const 种子 = /种子=eq\.(\d+)/.exec(url)?.[1];
        const 域包 = /域包=eq\.([^&]+)/.exec(url)?.[1];
        const 行 = [...行集.values()].find(
          (r) => String(r.种子) === 种子 && r.域包 === 域包,
        );
        return route.fulfill({ status: 200, body: JSON.stringify(行 ? [行] : []) });
      }
      if (请求.method() === "POST") {
        const 体 = 请求.postDataJSON() as 云端进度行 | 云端进度行[];
        for (const 行 of Array.isArray(体) ? 体 : [体]) {
          行集.set(键(行), 行);
          收到的写.push(行);
        }
        return route.fulfill({ status: 201, body: "[]" });
      }
      return route.continue();
    });
  };
  return { 行集, 收到的写, 挂, 键 };
}
