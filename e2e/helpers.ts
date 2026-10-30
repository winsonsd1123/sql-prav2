// E2E 共享辅助：登录态预置（issue #25）。
// 强制登录后，既有演练场 spec 需要在导航前预置一份未过期的 Supabase 登录态
// （浏览器客户端固定存储键「演练场-supabase-auth」；auth-js 2.118 存扁平 Session 对象，
//  顶层须含 access_token/refresh_token/expires_at，getSession 离线可读）。
import type { Page } from "@playwright/test";

export async function presetLoginState(page: Page) {
  await page.addInitScript(() => {
    const session = {
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "e2e-user", email: "e2e@cuc.edu.cn", aud: "authenticated" },
    };
    localStorage.setItem("演练场-supabase-auth", JSON.stringify(session));
  });
}

// T6 · 进度上云（issue #28）：Supabase REST 进度表的云端桩。
// 拦截 /rest/v1/practice_progress 的 GET（恢复拉取）与 POST（节流 upsert），
// 行集跨 page/context 共享（跨浏览器上下文恢复用例），离线可跑。
// 表名已英文化：glob 可直接匹配，无需百分号解码分流。

export interface CloudProgressRow {
  user_id: string;
  seed: number;
  pack_id: string;
  progress: {
    passedIndices?: number[];
    hintsSeen?: Record<string, number>;
    assistedAnswerIndices?: number[];
    attemptCounts?: Record<string, number>;
    drafts?: Record<string, string>;
  };
}

export function createCloudProgressStub() {
  const rows = new Map<string, CloudProgressRow>();
  const receivedWrites = [] as CloudProgressRow[];
  const rowKey = (r: { user_id: string; seed: number; pack_id: string }) =>
    `${r.user_id}:${r.pack_id}:${r.seed}`;
  const attach = async (page: Page) => {
    await page.route("**/rest/v1/practice_progress*", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        const url = request.url();
        const seed = /seed=eq\.(\d+)/.exec(url)?.[1];
        const packId = /pack_id=eq\.([^&]+)/.exec(url)?.[1];
        const row = [...rows.values()].find(
          (r) => String(r.seed) === seed && r.pack_id === packId,
        );
        return route.fulfill({ status: 200, body: JSON.stringify(row ? [row] : []) });
      }
      if (request.method() === "POST") {
        const body = request.postDataJSON() as CloudProgressRow | CloudProgressRow[];
        for (const row of Array.isArray(body) ? body : [body]) {
          rows.set(rowKey(row), row);
          receivedWrites.push(row);
        }
        return route.fulfill({ status: 201, body: "[]" });
      }
      return route.continue();
    });
  };
  return { rows, receivedWrites, attach, rowKey };
}
