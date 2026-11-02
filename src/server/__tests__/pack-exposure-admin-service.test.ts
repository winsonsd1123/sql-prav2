// 接缝：域包放出管理服务（模块边界，issue #55）——注入假的 token 验证/权限/清单读写，
// 只测鉴权前置（访问后台 + 域包管理 双权限点）与全量保存编排；照白名单服务测试模式。
import { describe, expect, it, vi } from "vitest";
import {
  getAdminPackExposure,
  saveAdminPackExposure,
  type AdminDeps,
} from "@/server/admin-service";

function makeDeps(overrides: Partial<AdminDeps> = {}): AdminDeps {
  return {
    verifyAccessToken: async (token) => (token === "valid-token" ? { userId: "admin-1" } : null),
    // 域包放出管理默认持双权限点（后台管理入口 + 域包管理）
    fetchUserPermissions: async () => ["访问后台", "域包管理"],
    fetchProfilePage: async () => ({ rows: [], total: 0 }),
    fetchAllUserRoles: async () => [],
    fetchBannedUserIds: async () => new Set<string>(),
    fetchValidRoleNames: async () => [],
    fetchRolePermissions: async () => [],
    fetchUserRolesByUser: async () => [],
    writeUserRoleChanges: async () => ({ add: [], remove: [] }),
    setUserBanned: async () => undefined,
    fetchAllowlistView: async () => ({ allowAnyDomain: false, domains: [] }),
    replaceAllowlistDomains: async () => undefined,
    updateAllowAnyDomain: async () => undefined,
    // #55 新增接缝：域包放出清单读写（用例不触时给空实现）
    fetchExposedPackIds: async () => [],
    replaceExposedPackIds: async () => undefined,
    // #79 新增接缝：词表读写（本文件用例不触，给空实现补齐 AdminDeps 形状）
    fetchKnowledgeAreas: async () => [],
    insertKnowledgeArea: async () => ({ status: "ok", id: "ka-1" }),
    updateKnowledgeArea: async () => "updated",
    deleteKnowledgeArea: async () => "deleted",
    setKnowledgeAreaActive: async () => "updated",
    ...overrides,
  };
}

describe("域包放出清单读取（getAdminPackExposure）", () => {
  it("鉴权前置：无 token 401，不触清单读取", async () => {
    const fetchExposedPackIds = vi.fn();
    const result = await getAdminPackExposure(null, makeDeps({ fetchExposedPackIds: fetchExposedPackIds as never }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(fetchExposedPackIds).not.toHaveBeenCalled();
  });

  it("鉴权前置：持「访问后台」但无「域包管理」权限点 403（判定只认权限点）", async () => {
    const result = await getAdminPackExposure(
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => ["访问后台"] }),
    );
    expect(result).toEqual({ status: "forbidden" });
  });

  it("放行：返回当前放出的 packId 列表", async () => {
    const result = await getAdminPackExposure(
      "Bearer valid-token",
      makeDeps({ fetchExposedPackIds: async () => ["student-course-grade"] }),
    );
    expect(result).toEqual({ status: "ok", packIds: ["student-course-grade"] });
  });

  it("读取异常：error", async () => {
    const result = await getAdminPackExposure(
      "Bearer valid-token",
      makeDeps({ fetchExposedPackIds: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "error" });
  });
});

describe("域包放出清单全量保存（saveAdminPackExposure）", () => {
  it("鉴权前置：无「域包管理」权限点 403，不落库", async () => {
    const replace = vi.fn();
    const result = await saveAdminPackExposure(
      ["student-course-grade"],
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => ["访问后台"], replaceExposedPackIds: replace as never }),
    );
    expect(result).toEqual({ status: "forbidden" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("全量替换：载荷归一（去空白、去重）后落库", async () => {
    const replace = vi.fn();
    const result = await saveAdminPackExposure(
      [" student-course-grade ", "employee-department-payroll", "student-course-grade"],
      "Bearer valid-token",
      makeDeps({ replaceExposedPackIds: replace }),
    );
    expect(result).toEqual({ status: "ok" });
    expect(replace).toHaveBeenCalledWith(["student-course-grade", "employee-department-payroll"]);
  });

  it("空清单合法：清空全部行 = 回到未配置（学生端默认全放）", async () => {
    const replace = vi.fn();
    const result = await saveAdminPackExposure([], "Bearer valid-token", makeDeps({ replaceExposedPackIds: replace }));
    expect(result).toEqual({ status: "ok" });
    expect(replace).toHaveBeenCalledWith([]);
  });

  it("非法载荷（非字符串/空白项/非数组）invalid", async () => {
    const replace = vi.fn();
    expect(await saveAdminPackExposure("nope" as never, "Bearer valid-token", makeDeps())).toEqual({ status: "invalid" });
    expect(await saveAdminPackExposure([123 as never], "Bearer valid-token", makeDeps())).toEqual({ status: "invalid" });
    expect(await saveAdminPackExposure(["  "], "Bearer valid-token", makeDeps())).toEqual({ status: "invalid" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("落库异常：error", async () => {
    const result = await saveAdminPackExposure(
      ["student-course-grade"],
      "Bearer valid-token",
      makeDeps({ replaceExposedPackIds: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "error" });
  });
});
