// 域包生成/发布 API e2e（票 #59）：直打真实路由的协议边界——
// 请求体形状校验（400）、未配置 DEEPSEEK_API_KEY 的明确 503（不静默）、
// 无效登录态 401（真路由 → 云端认证拒绝垃圾 token；网络不可达同样回落 401）。
// LLM 打桩的完整流程（生成成功/闸门拒绝/发布落库）在服务层与路由层单测覆盖
// （服务端对 DeepSeek 的出站 fetch 无法被 Playwright 拦截，故不在 e2e 重复）；
// 教师端页面交互（#60）落地后补页面级 e2e。
import { test, expect } from "@playwright/test";

test.describe("POST /api/admin/domain-packs/generate", () => {
  test("请求体缺场景描述：400", async ({ request }) => {
    const response = await request.post("/api/admin/domain-packs/generate", { data: {} });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("场景描述");
  });

  test("未配置 DEEPSEEK_API_KEY（e2e 环境不注入 key）：503 明确报错码，不静默降级", async ({ request }) => {
    const response = await request.post("/api/admin/domain-packs/generate", {
      data: { description: "图书馆借阅场景：读者、图书、借阅记录" },
      headers: { authorization: "Bearer e2e-not-a-real-token" },
    });
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("llm_not_configured");
  });
});

test.describe("POST /api/admin/domain-packs/publish", () => {
  test("请求体缺 pack：400", async ({ request }) => {
    const response = await request.post("/api/admin/domain-packs/publish", { data: {} });
    expect(response.status()).toBe(400);
  });

  test("无效登录态：401（真路由经云端认证拒绝，不落库）", async ({ request }) => {
    const response = await request.post("/api/admin/domain-packs/publish", {
      data: { pack: { packId: "e2e-should-never-publish" } },
      headers: { authorization: "Bearer e2e-not-a-real-token" },
    });
    expect(response.status()).toBe(401);
  });
});
