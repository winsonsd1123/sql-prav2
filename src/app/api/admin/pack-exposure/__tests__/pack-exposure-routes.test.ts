// 接缝：域包放出管理路由（协议边界，issue #55）——mock 后台管理服务，
// 只测 HTTP 状态码、载荷映射与请求体解析。鉴权 401/403 行为在服务层单测断言，不在此重复。
import { describe, expect, it, vi, beforeEach } from "vitest";

const getAdminPackExposureMock = vi.fn();
const saveAdminPackExposureMock = vi.fn();

vi.mock("@/server/admin-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin-service")>()),
  getAdminPackExposure: (...args: unknown[]) => getAdminPackExposureMock(...args),
  saveAdminPackExposure: (...args: unknown[]) => saveAdminPackExposureMock(...args),
}));

import { GET, PUT } from "@/app/api/admin/pack-exposure/route";

function request(url: string, init: RequestInit = {}): Request {
  return new Request(url, init) as never;
}

beforeEach(() => {
  getAdminPackExposureMock.mockReset();
  saveAdminPackExposureMock.mockReset();
});

describe("GET /api/admin/pack-exposure", () => {
  it("Authorization 头原样透传业务层", async () => {
    getAdminPackExposureMock.mockResolvedValue({ status: "ok", packIds: [] });
    await GET(request("http://localhost/api/admin/pack-exposure", { headers: { authorization: "Bearer tok" } }));
    expect(getAdminPackExposureMock).toHaveBeenCalledWith("Bearer tok");
  });

  it("放行：200 返回放出清单全量", async () => {
    getAdminPackExposureMock.mockResolvedValue({ status: "ok", packIds: ["student-course-grade"] });
    const response = await GET(request("http://localhost/api/admin/pack-exposure", { headers: { authorization: "Bearer t" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ packIds: ["student-course-grade"] });
  });

  it("鉴权失败：401 / 403；服务异常：500", async () => {
    getAdminPackExposureMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await GET(request("http://localhost/api/admin/pack-exposure"))).status).toBe(401);
    getAdminPackExposureMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await GET(request("http://localhost/api/admin/pack-exposure"))).status).toBe(403);
    getAdminPackExposureMock.mockResolvedValueOnce({ status: "error" });
    expect((await GET(request("http://localhost/api/admin/pack-exposure"))).status).toBe(500);
  });
});

describe("PUT /api/admin/pack-exposure", () => {
  function putRequest(body: unknown, authorization = "Bearer t") {
    return request("http://localhost/api/admin/pack-exposure", {
      method: "PUT",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("packIds 与 Authorization 头透传业务层；空清单（全不放）合法", async () => {
    saveAdminPackExposureMock.mockResolvedValue({ status: "ok" });
    const response = await PUT(putRequest({ packIds: ["student-course-grade"] }, "Bearer tok"));
    expect(response.status).toBe(200);
    expect(saveAdminPackExposureMock).toHaveBeenCalledWith(["student-course-grade"], "Bearer tok");
    await PUT(putRequest({ packIds: [] }));
    expect(saveAdminPackExposureMock).toHaveBeenCalledWith([], "Bearer t");
  });

  it("请求体非合法 JSON 或形状不符（缺 packIds / 非数组）：400", async () => {
    expect((await PUT(putRequest("{oops"))).status).toBe(400);
    expect((await PUT(putRequest({}))).status).toBe(400);
    expect((await PUT(putRequest({ packIds: "a" }))).status).toBe(400);
  });

  it("业务层 invalid：400；鉴权失败：401 / 403；服务异常：500", async () => {
    saveAdminPackExposureMock.mockResolvedValueOnce({ status: "invalid" });
    const invalid = await PUT(putRequest({ packIds: ["  "] }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "放出清单格式不正确" });
    saveAdminPackExposureMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await PUT(putRequest({ packIds: [] }))).status).toBe(401);
    saveAdminPackExposureMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await PUT(putRequest({ packIds: [] }))).status).toBe(403);
    saveAdminPackExposureMock.mockResolvedValueOnce({ status: "error" });
    expect((await PUT(putRequest({ packIds: [] }))).status).toBe(500);
  });
});
