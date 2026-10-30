// 接缝：用户列表路由（协议边界）——mock 后台管理服务，只测 HTTP 状态码与载荷映射、query 透传。
import { describe, expect, it, vi, beforeEach } from "vitest";

const listAdminUsersMock = vi.fn();

vi.mock("@/server/admin-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin-service")>()),
  listAdminUsers: (...args: unknown[]) => listAdminUsersMock(...args),
}));

import { GET } from "@/app/api/admin/users/route";

function usersRequest(url = "http://localhost/api/admin/users?q=&page=1", authorization: string | null = "Bearer t") {
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  return GET(new Request(url, { headers }) as never);
}

beforeEach(() => listAdminUsersMock.mockReset());

describe("用户列表路由", () => {
  it("query 与 Authorization 头原样透传业务层", async () => {
    listAdminUsersMock.mockResolvedValue({ status: "unauthorized" });
    await usersRequest("http://localhost/api/admin/users?q=张三&page=2", "Bearer tok");
    expect(listAdminUsersMock).toHaveBeenCalledWith({ q: "张三", page: "2" }, "Bearer tok");
  });

  it("缺省 query 参数：以空串透传", async () => {
    listAdminUsersMock.mockResolvedValue({ status: "ok", users: [], total: 0, page: 1, pageSize: 20 });
    await usersRequest("http://localhost/api/admin/users");
    expect(listAdminUsersMock).toHaveBeenCalledWith({ q: "", page: "" }, "Bearer t");
  });

  it("放行：200 返回用户列表载荷", async () => {
    const payload = {
      status: "ok",
      users: [{ userId: "u1", studentId: "2022110001", realName: "张三", nickname: null, email: "z@cuc.edu.cn", roles: ["学生"], banned: false, createdAt: "2026-10-01T00:00:00Z" }],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    listAdminUsersMock.mockResolvedValue(payload);
    const response = await usersRequest();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: payload.users,
      total: payload.total,
      page: payload.page,
      pageSize: payload.pageSize,
    });
  });

  it("无 Authorization / token 无效：401 统一文案", async () => {
    listAdminUsersMock.mockResolvedValue({ status: "unauthorized" });
    const noHeader = await usersRequest("http://localhost/api/admin/users", null);
    expect(noHeader.status).toBe(401);
    await expect(noHeader.json()).resolves.toEqual({ error: "未登录或登录态已失效" });
  });

  it("无「访问后台」权限点：403", async () => {
    listAdminUsersMock.mockResolvedValue({ status: "forbidden" });
    const response = await usersRequest();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "没有访问后台的权限" });
  });

  it("业务层返回服务不可用：500 通用文案", async () => {
    listAdminUsersMock.mockResolvedValue({ status: "error" });
    const response = await usersRequest();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "管理服务暂不可用，请稍后重试" });
  });

  it("业务层抛异常：500 通用文案（不泄露内部细节）", async () => {
    listAdminUsersMock.mockRejectedValueOnce(new Error("数据库炸了"));
    const response = await usersRequest();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "管理服务暂不可用，请稍后重试" });
  });
});
