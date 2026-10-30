// 接缝：白名单管理三个路由（协议边界）——mock 后台管理服务，只测 HTTP 状态码、载荷映射与请求体解析。
import { describe, expect, it, vi, beforeEach } from "vitest";

const getAdminWhitelistMock = vi.fn();
const saveAdminWhitelistDomainsMock = vi.fn();
const updateAdminWhitelistConfigMock = vi.fn();

vi.mock("@/server/admin-service", () => ({
  getAdminWhitelist: (...args: unknown[]) => getAdminWhitelistMock(...args),
  saveAdminWhitelistDomains: (...args: unknown[]) => saveAdminWhitelistDomainsMock(...args),
  updateAdminWhitelistConfig: (...args: unknown[]) => updateAdminWhitelistConfigMock(...args),
}));

import { GET } from "@/app/api/admin/whitelist/route";
import { PUT } from "@/app/api/admin/whitelist/domains/route";
import { PATCH } from "@/app/api/admin/whitelist/config/route";

function request(url: string, init: RequestInit = {}): Request {
  return new Request(url, init) as never;
}

beforeEach(() => {
  getAdminWhitelistMock.mockReset();
  saveAdminWhitelistDomainsMock.mockReset();
  updateAdminWhitelistConfigMock.mockReset();
});

describe("GET /api/admin/whitelist", () => {
  it("Authorization 头原样透传业务层", async () => {
    getAdminWhitelistMock.mockResolvedValue({ status: "unauthorized" });
    await GET(request("http://localhost/api/admin/whitelist", { headers: { authorization: "Bearer tok" } }));
    expect(getAdminWhitelistMock).toHaveBeenCalledWith("Bearer tok");
  });

  it("放行：200 返回含备注的管理视图", async () => {
    getAdminWhitelistMock.mockResolvedValue({
      status: "ok",
      allowAnyDomain: false,
      domains: [{ domain: "cuc.edu.cn", note: "校内主域" }],
    });
    const response = await GET(request("http://localhost/api/admin/whitelist", { headers: { authorization: "Bearer t" } }));
    expect(response?.status).toBe(200);
    await expect(response!.json()).resolves.toEqual({
      allowAnyDomain: false,
      domains: [{ domain: "cuc.edu.cn", note: "校内主域" }],
    });
  });

  it("无 token：401；无权限点：403；服务异常：500", async () => {
    getAdminWhitelistMock.mockResolvedValueOnce({ status: "unauthorized" });
    const unauthorized = await GET(request("http://localhost/api/admin/whitelist"));
    expect(unauthorized?.status).toBe(401);
    getAdminWhitelistMock.mockResolvedValueOnce({ status: "forbidden" });
    const forbidden = await GET(request("http://localhost/api/admin/whitelist"));
    expect(forbidden?.status).toBe(403);
    getAdminWhitelistMock.mockResolvedValueOnce({ status: "error" });
    const error = await GET(request("http://localhost/api/admin/whitelist"));
    expect(error?.status).toBe(500);
  });
});

describe("PUT /api/admin/whitelist/domains", () => {
  function putRequest(body: unknown, authorization = "Bearer t") {
    return request("http://localhost/api/admin/whitelist/domains", {
      method: "PUT",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("解析后的清单与 Authorization 头透传业务层（note 可选）", async () => {
    saveAdminWhitelistDomainsMock.mockResolvedValue({ status: "ok" });
    await PUT(putRequest({ domains: [{ domain: "cuc.edu.cn", note: "校内" }, { domain: "bfsu.edu.cn" }] }, "Bearer tok"));
    expect(saveAdminWhitelistDomainsMock).toHaveBeenCalledWith(
      [{ domain: "cuc.edu.cn", note: "校内" }, { domain: "bfsu.edu.cn" }],
      "Bearer tok",
    );
  });

  it("空清单合法：透传空数组", async () => {
    saveAdminWhitelistDomainsMock.mockResolvedValue({ status: "ok" });
    const response = await PUT(putRequest({ domains: [] }));
    expect(response.status).toBe(200);
    expect(saveAdminWhitelistDomainsMock).toHaveBeenCalledWith([], "Bearer t");
  });

  it("请求体非合法 JSON：400 通用文案", async () => {
    const response = await PUT(putRequest("{oops"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请求体格式不正确" });
  });

  it("请求体形状不符（缺 domains / 非数组条目）：400", async () => {
    const missing = await PUT(putRequest({}));
    expect(missing?.status).toBe(400);
    const notArray = await PUT(putRequest({ domains: "cuc.edu.cn" }));
    expect(notArray?.status).toBe(400);
    const missingDomain = await PUT(putRequest({ domains: [{ note: "缺域名" }] }));
    expect(missingDomain?.status).toBe(400);
  });

  it("业务层 invalid：400 回传业务层文案", async () => {
    saveAdminWhitelistDomainsMock.mockResolvedValue({ status: "invalid", error: "域名格式不正确" });
    const response = await PUT(putRequest({ domains: [{ domain: "bad" }] }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "域名格式不正确" });
  });

  it("鉴权失败：401 / 403；服务异常：500", async () => {
    saveAdminWhitelistDomainsMock.mockResolvedValueOnce({ status: "unauthorized" });
    const unauthorized = await PUT(putRequest({ domains: [] }));
    expect(unauthorized?.status).toBe(401);
    saveAdminWhitelistDomainsMock.mockResolvedValueOnce({ status: "forbidden" });
    const forbidden = await PUT(putRequest({ domains: [] }));
    expect(forbidden?.status).toBe(403);
    saveAdminWhitelistDomainsMock.mockResolvedValueOnce({ status: "error" });
    const error = await PUT(putRequest({ domains: [] }));
    expect(error?.status).toBe(500);
  });
});

describe("PATCH /api/admin/whitelist/config", () => {
  function patchRequest(body: unknown, authorization = "Bearer t") {
    return request("http://localhost/api/admin/whitelist/config", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("allowAnyDomain 与 Authorization 头透传业务层", async () => {
    updateAdminWhitelistConfigMock.mockResolvedValue({ status: "ok" });
    const response = await PATCH(patchRequest({ allowAnyDomain: true }, "Bearer tok"));
    expect(response.status).toBe(200);
    expect(updateAdminWhitelistConfigMock).toHaveBeenCalledWith(true, "Bearer tok");
  });

  it("请求体形状不符（缺字段 / 非布尔）：400", async () => {
    const missing = await PATCH(patchRequest("{}"));
    expect(missing?.status).toBe(400);
    const notBoolean = await PATCH(patchRequest({ allowAnyDomain: "yes" }));
    expect(notBoolean?.status).toBe(400);
    const broken = await PATCH(patchRequest("{oops"));
    expect(broken?.status).toBe(400);
  });

  it("鉴权失败：401 / 403；服务异常：500", async () => {
    updateAdminWhitelistConfigMock.mockResolvedValueOnce({ status: "unauthorized" });
    const unauthorized = await PATCH(patchRequest({ allowAnyDomain: true }));
    expect(unauthorized?.status).toBe(401);
    updateAdminWhitelistConfigMock.mockResolvedValueOnce({ status: "forbidden" });
    const forbidden = await PATCH(patchRequest({ allowAnyDomain: true }));
    expect(forbidden?.status).toBe(403);
    updateAdminWhitelistConfigMock.mockResolvedValueOnce({ status: "error" });
    const error = await PATCH(patchRequest({ allowAnyDomain: true }));
    expect(error?.status).toBe(500);
  });
});
