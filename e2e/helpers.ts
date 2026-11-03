// E2E 共享辅助：登录态预置（issue #25）。
// 强制登录后，既有演练场 spec 需要在导航前预置一份未过期的 Supabase 登录态
// （浏览器客户端固定存储键「演练场-supabase-auth」；auth-js 2.118 存扁平 Session 对象，
//  顶层须含 access_token/refresh_token/expires_at，getSession 离线可读）。
import { expect, type Page } from "@playwright/test";

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

// console 卫生断言（用户指令加严，2026-10-31 真库 key 警告追因后）：收集用例期间页面的 console error/warning 与未捕获异常，
// 供 afterEach 断言为空——DOM 正确但 console 报错的体验层缺陷（未捕获异常、请求错误等）不逃逸。
// 边界：React 的 key 类警告是 dev-only（生产 build 剥除），此处捕获的是生产可观测问题；
// dev-only 警告的复现走 dev server 手动/脚本验证（2026-10 已验证 admin 列表全分支零警告）。
export function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`[${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`[pageerror] ${error.message}`));
  return problems;
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

// 云端域包资产表桩（票 #57）：演练场加载层会拉 /rest/v1/domain_pack_asset 合并云端域包，
// 离线 e2e 回放内存行集（默认空 = 云端无域包，学生端仅见内置两包）。
export interface DomainPackAssetRow {
  pack_id: string;
  asset: unknown;
}

export function createDomainPackAssetStub() {
  const rows: DomainPackAssetRow[] = [];
  const attach = async (page: Page) => {
    await page.route("**/rest/v1/domain_pack_asset*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    });
  };
  return { rows, attach };
}

// console 卫生断言收口（#96 验收补丁）：exemptions 为可选豁免正则，仅限「桩失败响应引发的
// 浏览器资源加载报错」这类无法补桩消除的预期噪声，且必须收窄到桩了失败资源的用例内传参——
// 文件级豁免会让同文件其他用例的违例逃逸。豁免口径登记见 docs/e2e-conventions.md。
export function expectConsoleClean(problems: string[], exemptions: RegExp[] = []) {
  const effective = exemptions.length
    ? problems.filter((m) => !exemptions.some((r) => r.test(m)))
    : problems;
  expect(effective, `console 卫生违例：\n${effective.join("\n")}`).toEqual([]);
}

// 版本历史表桩（票 #62）：加载层会随资产表一并拉 /rest/v1/domain_pack_version_history，
// 学生端离线 e2e 回放内存行集（默认空 = 无历史版本，进行中会话无需钉旧版）。
// 已有 spec 只桩资产表时会漏出这张表的真实请求（anon 401 打进 console 卫生），故单列。
export function createDomainPackVersionHistoryStub() {
  const rows: DomainPackAssetRow[] = [];
  const attach = async (page: Page) => {
    await page.route("**/rest/v1/domain_pack_version_history*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    });
  };
  return { rows, attach };
}
