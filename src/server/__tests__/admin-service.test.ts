// 接缝：后台管理服务（模块边界）——注入假的 token 验证/权限查询/数据查询，只测鉴权链与列表编排。
// 照登录服务测试模式：makeDeps 工厂 + 行为断言，不触网络层。
import { describe, expect, it, vi } from "vitest";
import {
  authorizeAdminRequest,
  listAdminUsers,
  type AdminDeps,
  type AdminProfileRow,
  type AdminRoleRow,
} from "@/server/admin-service";

function makeDeps(overrides: Partial<AdminDeps> = {}): AdminDeps {
  return {
    verifyAccessToken: async (token) => (token === "valid-token" ? { userId: "admin-1" } : null),
    fetchUserPermissions: async () => ["访问后台"],
    fetchProfilePage: async () => ({ rows: [], total: 0 }),
    fetchAllUserRoles: async () => [],
    fetchBannedUserIds: async () => new Set<string>(),
    fetchAllowlistView: async () => ({ allowAnyDomain: false, domains: [] }),
    replaceAllowlistDomains: async () => undefined,
    updateAllowAnyDomain: async () => undefined,
    ...overrides,
  };
}

describe("鉴权链（ADR-0007 共享收口）", () => {
  it("无 Authorization 头：401，不触 token 验证", async () => {
    const verifyAccessToken = vi.fn();
    const result = await authorizeAdminRequest(null, makeDeps({ verifyAccessToken: verifyAccessToken as never }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("非 Bearer 方案：401", async () => {
    expect(await authorizeAdminRequest("Basic abc", makeDeps())).toEqual({ status: "unauthorized" });
  });

  it("空 Bearer token：401", async () => {
    expect(await authorizeAdminRequest("Bearer ", makeDeps())).toEqual({ status: "unauthorized" });
  });

  it("token 无效（云端认证拒绝）：401", async () => {
    const result = await authorizeAdminRequest("Bearer bad-token", makeDeps());
    expect(result).toEqual({ status: "unauthorized" });
  });

  it("token 有效但无「访问后台」权限点：403", async () => {
    const result = await authorizeAdminRequest(
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => ["随时查看参考答案"] }),
    );
    expect(result).toEqual({ status: "forbidden" });
  });

  it("权限查询失败回退空集合：按 403 处理（安全默认）", async () => {
    const result = await authorizeAdminRequest(
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "forbidden" });
  });

  it("持「访问后台」（多角色并集含该点）：放行并返回 userId", async () => {
    const fetchUserPermissions = vi.fn(async () => ["随时查看参考答案", "访问后台"]);
    const result = await authorizeAdminRequest("Bearer valid-token", makeDeps({ fetchUserPermissions }));
    expect(result).toEqual({ status: "ok", userId: "admin-1" });
  });
});

const profileRows: AdminProfileRow[] = [
  { user_id: "u1", student_id: "2022110001", real_name: "张三", nickname: "三三", email: "zhang@cuc.edu.cn", created_at: "2026-10-02T10:00:00Z" },
  { user_id: "u2", student_id: "2022110002", real_name: "李四", nickname: null, email: "li@cuc.edu.cn", created_at: "2026-10-01T10:00:00Z" },
];
const roleRows: AdminRoleRow[] = [
  { user_id: "u1", role: "学生" },
  { user_id: "u2", role: "学生" },
  { user_id: "u2", role: "助教" },
];

function makeDataDeps(overrides: Partial<AdminDeps> = {}) {
  return makeDeps({
    fetchProfilePage: async (query) => {
      const rows = query.search ? profileRows.filter((r) => r.real_name === query.search) : profileRows;
      return { rows, total: rows.length };
    },
    fetchAllUserRoles: async () => roleRows,
    fetchBannedUserIds: async () => new Set(["u2"]),
    ...overrides,
  });
}

describe("用户列表编排", () => {
  it("鉴权前置：无 token 直接 401，不触数据查询", async () => {
    const fetchProfilePage = vi.fn();
    const result = await listAdminUsers({ q: "", page: "1" }, null, makeDeps({ fetchProfilePage: fetchProfilePage as never }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(fetchProfilePage).not.toHaveBeenCalled();
  });

  it("鉴权前置：无权限点 403，不触数据查询", async () => {
    const fetchProfilePage = vi.fn();
    const result = await listAdminUsers(
      { q: "", page: "1" },
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => [], fetchProfilePage: fetchProfilePage as never }),
    );
    expect(result).toEqual({ status: "forbidden" });
    expect(fetchProfilePage).not.toHaveBeenCalled();
  });

  it("放行：归一后的查询下发，合并角色与封禁状态返回用户行", async () => {
    const fetchProfilePage = vi.fn(async () => ({ rows: profileRows, total: 2 }));
    const result = await listAdminUsers({ q: "  ", page: "0" }, "Bearer valid-token", makeDataDeps({ fetchProfilePage }));
    expect(fetchProfilePage).toHaveBeenCalledWith({ search: "", page: 1, pageSize: 20 });
    expect(result).toEqual({
      status: "ok",
      users: [
        { userId: "u1", studentId: "2022110001", realName: "张三", nickname: "三三", email: "zhang@cuc.edu.cn", roles: ["学生"], banned: false, createdAt: "2026-10-02T10:00:00Z" },
        { userId: "u2", studentId: "2022110002", realName: "李四", nickname: null, email: "li@cuc.edu.cn", roles: ["学生", "助教"], banned: true, createdAt: "2026-10-01T10:00:00Z" },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
  });

  it("搜索词透传（分页查询带 search）", async () => {
    const fetchProfilePage = vi.fn(async (query: { search: string }) => ({ rows: profileRows.filter((r) => r.real_name === query.search), total: 1 }));
    const result = await listAdminUsers({ q: "张三", page: "1" }, "Bearer valid-token", makeDataDeps({ fetchProfilePage }));
    expect(fetchProfilePage).toHaveBeenCalledWith({ search: "张三", page: 1, pageSize: 20 });
    expect(result.status === "ok" && result.users).toHaveLength(1);
    expect(result.status === "ok" && result.users[0].realName).toBe("张三");
  });

  it("数据层抛异常：服务不可用（500 语义），不向调用方泄露细节", async () => {
    const result = await listAdminUsers(
      { q: "", page: "1" },
      "Bearer valid-token",
      makeDeps({ fetchProfilePage: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "error" });
  });
});
