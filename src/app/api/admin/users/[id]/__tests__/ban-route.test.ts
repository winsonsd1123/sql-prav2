// 接缝：账号禁用/启用路由（协议边界）——mock 后台管理服务，只测 HTTP 状态码、载荷映射与参数/头透传。
import { describe, expect, it, vi, beforeEach } from "vitest";

const setAdminUserBanMock = vi.fn();

vi.mock("@/server/admin-service", () => ({
  setAdminUserBan: (...args: unknown[]) => setAdminUserBanMock(...args),
}));

import { PATCH } from "@/app/api/admin/users/[id]/route";

function patchRequest(body: unknown, authorization: string | null = "Bearer t") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  return PATCH(new Request("http://localhost/api/admin/users/u1", { method: "PATCH", headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "u1" }),
  });
}

beforeEach(() => setAdminUserBanMock.mockReset());

describe("账号禁用/启用路由", () => {
  it("路径 id、载荷 banned 与 Authorization 头原样透传业务层", async () => {
    setAdminUserBanMock.mockResolvedValue({ status: "ok", banned: true });
    await patchRequest({ banned: true }, "Bearer tok");
    expect(setAdminUserBanMock).toHaveBeenCalledWith("u1", true, "Bearer tok");
  });

  it("载荷非 JSON 对象：400 通用文案", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/users/u1", {
        method: "PATCH",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: "not-json",
      }),
      { params: Promise.resolve({ id: "u1" }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请求载荷不合法" });
  });

  it("载荷 banned 非布尔：400", async () => {
    setAdminUserBanMock.mockResolvedValue({ status: "invalid_banned" });
    const response = await patchRequest({ banned: "yes" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "载荷不合法：banned 必须是布尔值" });
  });

  it("自我保护被拒：400 专用文案", async () => {
    setAdminUserBanMock.mockResolvedValue({ status: "self_protection" });
    const response = await patchRequest({ banned: true });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "不能禁用自己的账号" });
  });

  it("放行：200 返回封禁结果", async () => {
    setAdminUserBanMock.mockResolvedValue({ status: "ok", banned: false });
    const response = await patchRequest({ banned: false });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ banned: false });
  });

  it("无 Authorization / token 无效：401 统一文案", async () => {
    setAdminUserBanMock.mockResolvedValue({ status: "unauthorized" });
    const response = await patchRequest({ banned: true }, null);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录或登录态已失效" });
  });

  it("无「访问后台」权限点：403", async () => {
    setAdminUserBanMock.mockResolvedValue({ status: "forbidden" });
    const response = await patchRequest({ banned: true });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "没有访问后台的权限" });
  });

  it("业务层服务不可用 / 抛异常：500 通用文案", async () => {
    setAdminUserBanMock.mockResolvedValueOnce({ status: "error" });
    expect((await patchRequest({ banned: true })).status).toBe(500);
    setAdminUserBanMock.mockRejectedValueOnce(new Error("认证服务炸了"));
    const response = await patchRequest({ banned: true });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "管理服务暂不可用，请稍后重试" });
  });
});
