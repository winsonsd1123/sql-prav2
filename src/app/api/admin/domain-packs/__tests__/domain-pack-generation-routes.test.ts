// 接缝：域包生成/发布两个路由（协议边界，票 #59）——mock 编排服务与 provider 解析，
// 只测 HTTP 状态码、载荷映射与请求体解析；鉴权与编排行为在服务层单测覆盖。
import { describe, expect, it, vi, beforeEach } from "vitest";

const generateDomainPackDraftMock = vi.fn();
const publishDomainPackMock = vi.fn();
const resolveDeepSeekProviderMock = vi.fn();

vi.mock("@/server/domain-pack-generation-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/domain-pack-generation-service")>()),
  generateDomainPackDraft: (...args: unknown[]) => generateDomainPackDraftMock(...args),
  publishDomainPack: (...args: unknown[]) => publishDomainPackMock(...args),
}));
vi.mock("@/server/llm-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/llm-provider")>()),
  resolveDeepSeekProvider: () => resolveDeepSeekProviderMock(),
}));

import { POST as generate } from "@/app/api/admin/domain-packs/generate/route";
import { POST as publish } from "@/app/api/admin/domain-packs/publish/route";

const authHeader = { authorization: "Bearer tok" };
function postRequest(url: string, body: unknown, headers: Record<string, string> = authHeader): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveDeepSeekProviderMock.mockReturnValue({ model: "deepseek-flash", completeJson: async () => "{}" });
});

describe("POST /api/admin/domain-packs/generate", () => {
  it("解析后的请求体与 Authorization 头透传服务层", async () => {
    generateDomainPackDraftMock.mockResolvedValue({ status: "invalid" });
    await generate(postRequest("http://localhost/api/admin/domain-packs/generate", { description: "图书馆场景" }));
    expect(generateDomainPackDraftMock).toHaveBeenCalledWith({ description: "图书馆场景" }, "Bearer tok", expect.objectContaining({ provider: expect.anything() }));
  });

  it("生成成功：200 返回草稿与闸门报告", async () => {
    generateDomainPackDraftMock.mockResolvedValue({ status: "ok", draft: { packId: "x" }, report: { passed: true } });
    const response = await generate(postRequest("http://localhost/api/admin/domain-packs/generate", { description: "图书馆场景" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ draft: { packId: "x" }, report: { passed: true } });
  });

  it("请求体非 JSON 或形状不符：400", async () => {
    const badJson = await generate(postRequest("http://localhost/api/admin/domain-packs/generate", "{oops"));
    expect(badJson.status).toBe(400);
    const empty = await generate(postRequest("http://localhost/api/admin/domain-packs/generate", {}));
    expect(empty.status).toBe(400);
  });

  it("LLM 失败：502 返回明确错误码与可重试标记，不静默降级", async () => {
    generateDomainPackDraftMock.mockResolvedValueOnce({ status: "llm_error", kind: "network", message: "LLM 网络请求失败，可重试" });
    const llmError = await generate(postRequest("http://localhost/api/admin/domain-packs/generate", { description: "x" }));
    expect(llmError.status).toBe(502);
    const llmBody = await llmError.json();
    expect(llmBody).toMatchObject({ code: "llm_error", retryable: true });
    generateDomainPackDraftMock.mockResolvedValueOnce({ status: "llm_invalid_json", message: "LLM 输出不是合法 JSON" });
    const invalidJson = await generate(postRequest("http://localhost/api/admin/domain-packs/generate", { description: "x" }));
    expect(invalidJson.status).toBe(502);
    expect(await invalidJson.json()).toMatchObject({ code: "llm_invalid_json", retryable: true });
  });

  it("未配置 DEEPSEEK_API_KEY：503 明确提示（不静默）", async () => {
    resolveDeepSeekProviderMock.mockReturnValue(null);
    const response = await generate(postRequest("http://localhost/api/admin/domain-packs/generate", { description: "x" }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("llm_not_configured");
    expect(generateDomainPackDraftMock).not.toHaveBeenCalled();
  });

  it("鉴权失败：401 / 403；服务异常：500", async () => {
    generateDomainPackDraftMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await generate(postRequest("http://localhost/api/admin/domain-packs/generate", { description: "x" }))).status).toBe(401);
    generateDomainPackDraftMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await generate(postRequest("http://localhost/api/admin/domain-packs/generate", { description: "x" }))).status).toBe(403);
    generateDomainPackDraftMock.mockRejectedValueOnce(new Error("boom"));
    expect((await generate(postRequest("http://localhost/api/admin/domain-packs/generate", { description: "x" }))).status).toBe(500);
  });
});

describe("POST /api/admin/domain-packs/publish", () => {
  const pack = { packId: "x" };

  it("载荷与 Authorization 头透传服务层；成功 200 返回 packId", async () => {
    publishDomainPackMock.mockResolvedValue({ status: "ok", packId: "x" });
    const response = await publish(postRequest("http://localhost/api/admin/domain-packs/publish", { pack }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, packId: "x" });
    expect(publishDomainPackMock).toHaveBeenCalledWith({ pack }, "Bearer tok");
  });

  it("服务端闸门拒绝：422 返回闸门报告", async () => {
    publishDomainPackMock.mockResolvedValue({ status: "gate", report: { passed: false } });
    const response = await publish(postRequest("http://localhost/api/admin/domain-packs/publish", { pack }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, report: { passed: false } });
  });

  it("载荷缺 pack / 非 JSON：400", async () => {
    expect((await publish(postRequest("http://localhost/api/admin/domain-packs/publish", {}))).status).toBe(400);
    expect((await publish(postRequest("http://localhost/api/admin/domain-packs/publish", "{oops"))).status).toBe(400);
  });

  it("鉴权失败：401 / 403；落库失败：500", async () => {
    publishDomainPackMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await publish(postRequest("http://localhost/api/admin/domain-packs/publish", { pack }))).status).toBe(401);
    publishDomainPackMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await publish(postRequest("http://localhost/api/admin/domain-packs/publish", { pack }))).status).toBe(403);
    publishDomainPackMock.mockResolvedValueOnce({ status: "error", message: "连接失败" });
    expect((await publish(postRequest("http://localhost/api/admin/domain-packs/publish", { pack }))).status).toBe(500);
  });
});
