// 接缝：域包微调三路由（协议边界，票 #62）——mock 编排服务与 provider 解析，
// 只测 HTTP 状态码、载荷映射与请求体/查询参数解析；鉴权与编排在服务层单测覆盖。
import { describe, expect, it, vi, beforeEach } from "vitest";

const refineMock = vi.fn();
const applyMock = vi.fn();
const historyMock = vi.fn();
const resolveDeepSeekProviderMock = vi.fn();

vi.mock("@/server/domain-pack-refine-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/domain-pack-refine-service")>()),
  refineDomainPackDraft: (...args: unknown[]) => refineMock(...args),
  applyDomainPackRefinement: (...args: unknown[]) => applyMock(...args),
  getDomainPackVersionHistory: (...args: unknown[]) => historyMock(...args),
}));
vi.mock("@/server/llm-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/llm-provider")>()),
  resolveDeepSeekProvider: () => resolveDeepSeekProviderMock(),
}));

import { POST as refine } from "@/app/api/admin/domain-packs/refine/route";
import { POST as apply } from "@/app/api/admin/domain-packs/refine/apply/route";
import { GET as versions } from "@/app/api/admin/domain-packs/versions/route";

const authHeader = { authorization: "Bearer tok" };
function postRequest(url: string, body: unknown, headers: Record<string, string> = authHeader): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveDeepSeekProviderMock.mockReturnValue({ model: "deepseek-flash", completeJson: async () => "{}" });
});

describe("POST /api/admin/domain-packs/refine", () => {
  it("缺 packId 或意图：400", async () => {
    const response = await refine(postRequest("http://localhost/api/admin/domain-packs/refine", { packId: "x" }));
    expect(response.status).toBe(400);
    expect(refineMock).not.toHaveBeenCalled();
  });

  it("未配置 DEEPSEEK_API_KEY：503 明确报错码", async () => {
    resolveDeepSeekProviderMock.mockReturnValue(null);
    const response = await refine(postRequest("http://localhost/api/admin/domain-packs/refine", { packId: "x", intent: "改" }));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("llm_not_configured");
  });

  it("请求体与 Authorization 透传服务层；成功 200 返回草稿/报告/分类/版本预告", async () => {
    refineMock.mockResolvedValue({
      status: "ok",
      draft: { packId: "x" },
      report: { passed: true },
      changeClass: "B",
      currentVersionLabel: "v1",
      nextVersionLabel: "v2",
    });
    const response = await refine(postRequest("http://localhost/api/admin/domain-packs/refine", { packId: "x", intent: "改" }));
    expect(refineMock).toHaveBeenCalledWith({ packId: "x", intent: "改" }, "Bearer tok", expect.objectContaining({ provider: expect.anything() }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { changeClass: string; nextVersionLabel: string };
    expect(body.changeClass).toBe("B");
    expect(body.nextVersionLabel).toBe("v2");
  });

  it("not_found → 404；llm_error → 502 可重试；unauthorized → 401", async () => {
    refineMock.mockResolvedValueOnce({ status: "not_found" });
    expect((await refine(postRequest("http://l/api/admin/domain-packs/refine", { packId: "g", intent: "改" }))).status).toBe(404);
    refineMock.mockResolvedValueOnce({ status: "llm_error", kind: "network", message: "网络失败" });
    const r502 = await refine(postRequest("http://l/api/admin/domain-packs/refine", { packId: "x", intent: "改" }));
    expect(r502.status).toBe(502);
    expect(((await r502.json()) as { retryable: boolean }).retryable).toBe(true);
    refineMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await refine(postRequest("http://l/api/admin/domain-packs/refine", { packId: "x", intent: "改" }))).status).toBe(401);
  });
});

describe("POST /api/admin/domain-packs/refine/apply", () => {
  it("载荷缺 pack：400", async () => {
    const response = await apply(postRequest("http://l/api/admin/domain-packs/refine/apply", { packId: "x" }));
    expect(response.status).toBe(400);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("成功 200 返回 packId/分类/版本号", async () => {
    applyMock.mockResolvedValue({ status: "ok", packId: "library-loan@v2", changeClass: "B", versionLabel: "v2" });
    const response = await apply(postRequest("http://l/api/admin/domain-packs/refine/apply", { packId: "library-loan", pack: { packId: "library-loan" } }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { packId: string }).packId).toBe("library-loan@v2");
  });

  it("闸门拒绝 → 422 报告透传；基础名改动 → 409；无差异 → 409", async () => {
    applyMock.mockResolvedValueOnce({ status: "gate", report: { passed: false } });
    expect((await apply(postRequest("http://l/api/admin/domain-packs/refine/apply", { packId: "x", pack: {} }))).status).toBe(422);
    applyMock.mockResolvedValueOnce({ status: "base_name_changed", actualBasePackId: "renamed" });
    expect((await apply(postRequest("http://l/api/admin/domain-packs/refine/apply", { packId: "x", pack: {} }))).status).toBe(409);
    applyMock.mockResolvedValueOnce({ status: "no_change" });
    expect((await apply(postRequest("http://l/api/admin/domain-packs/refine/apply", { packId: "x", pack: {} }))).status).toBe(409);
  });
});

describe("GET /api/admin/domain-packs/versions", () => {
  it("缺 packId 查询参数：400", async () => {
    const response = await versions(new Request("http://l/api/admin/domain-packs/versions", { headers: authHeader }));
    expect(response.status).toBe(400);
  });

  it("packId 与 Authorization 透传；成功 200 返回版本列表", async () => {
    historyMock.mockResolvedValue({ status: "ok", versions: [{ packId: "x", versionLabel: "v1", name: "X", createdAt: null, isCurrent: true }] });
    const response = await versions(new Request("http://l/api/admin/domain-packs/versions?packId=x", { headers: authHeader }));
    expect(historyMock).toHaveBeenCalledWith("x", "Bearer tok");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { versions: unknown[] }).versions).toHaveLength(1);
  });

  it("forbidden → 403", async () => {
    historyMock.mockResolvedValue({ status: "forbidden" });
    expect((await versions(new Request("http://l/api/admin/domain-packs/versions?packId=x", { headers: authHeader }))).status).toBe(403);
  });
});
