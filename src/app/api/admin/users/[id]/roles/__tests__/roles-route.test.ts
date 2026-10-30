// 接缝：角色全量设置路由（协议边界）——mock 后台管理服务，只测 HTTP 状态码、载荷映射与参数/头透传。
import { describe, expect, it, vi, beforeEach } from "vitest";

const setAdminUserRolesMock = vi.fn();

vi.mock("@/server/admin-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin-service")>()),
  setAdminUserRoles: (...args: unknown[]) => setAdminUserRolesMock(...args),
}));

import { PUT } from "@/app/api/admin/users/[id]/roles/route";

function putRequest(body: unknown, authorization: string | null = "Bearer t", url = "http://localhost/api/admin/users/u1/roles") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  return PUT(new Request(url, { method: "PUT", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "u1" }) });
}

beforeEach(() => setAdminUserRolesMock.mockReset());

describe("角色全量设置路由", () => {
  it("路径 id、载荷 roles 与 Authorization 头原样透传业务层", async () => {
    setAdminUserRolesMock.mockResolvedValue({ status: "ok", roles: ["学生"] });
    await putRequest({ roles: ["学生", "助教"] }, "Bearer tok");
    expect(setAdminUserRolesMock).toHaveBeenCalledWith("u1", ["学生", "助教"], "Bearer tok");
  });

  it("载荷非 JSON 对象：400 通用文案", async () => {
    const headers = { authorization: "Bearer t", "content-type": "application/json" };
    const response = await PUT(
      new Request("http://localhost/api/admin/users/u1/roles", { method: "PUT", headers, body: "not-json" }),
      { params: Promise.resolve({ id: "u1" }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请求载荷不合法" });
  });

  it("载荷缺 roles 字段：以 undefined 透传，业务层判非法 → 400", async () => {
    setAdminUserRolesMock.mockResolvedValue({ status: "invalid_roles" });
    const response = await putRequest({});
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "角色名不合法" });
  });

  it("自我保护被拒：400 专用文案", async () => {
    setAdminUserRolesMock.mockResolvedValue({ status: "self_protection" });
    const response = await putRequest({ roles: ["学生"] });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "不能移除自己的后台访问权限" });
  });

  it("放行：200 返回全量集合", async () => {
    setAdminUserRolesMock.mockResolvedValue({ status: "ok", roles: ["学生", "管理员"] });
    const response = await putRequest({ roles: ["学生", "管理员"] });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ roles: ["学生", "管理员"] });
  });

  it("无 Authorization / token 无效：401 统一文案", async () => {
    setAdminUserRolesMock.mockResolvedValue({ status: "unauthorized" });
    const response = await putRequest({ roles: ["学生"] }, null);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录或登录态已失效" });
  });

  it("无「访问后台」权限点：403", async () => {
    setAdminUserRolesMock.mockResolvedValue({ status: "forbidden" });
    const response = await putRequest({ roles: ["学生"] });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "没有访问后台的权限" });
  });

  it("业务层服务不可用 / 抛异常：500 通用文案", async () => {
    setAdminUserRolesMock.mockResolvedValueOnce({ status: "error" });
    expect((await putRequest({ roles: ["学生"] })).status).toBe(500);
    setAdminUserRolesMock.mockRejectedValueOnce(new Error("数据库炸了"));
    const response = await putRequest({ roles: ["学生"] });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "管理服务暂不可用，请稍后重试" });
  });
});
