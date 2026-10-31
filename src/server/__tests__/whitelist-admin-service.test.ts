// 接缝：后台白名单管理服务（模块边界）——注入假的 token 验证/权限/白名单读写，只测鉴权前置与保存编排。
// 照登录服务测试模式：makeDeps 工厂 + 行为断言，不触网络层。
import { describe, expect, it, vi } from "vitest";
import {
  getAdminWhitelist,
  saveAdminWhitelistDomains,
  updateAdminWhitelistConfig,
  type AdminDeps,
} from "@/server/admin-service";

function makeDeps(overrides: Partial<AdminDeps> = {}): AdminDeps {
  return {
    verifyAccessToken: async (token) => (token === "valid-token" ? { userId: "admin-1" } : null),
    fetchUserPermissions: async () => ["访问后台"],
    fetchProfilePage: async () => ({ rows: [], total: 0 }),
    fetchAllUserRoles: async () => [],
    fetchBannedUserIds: async () => new Set<string>(),
    // T3 新增的角色读写接缝：白名单用例不触发，给空实现补齐 AdminDeps 形状
    fetchValidRoleNames: async () => [],
    fetchRolePermissions: async () => [],
    fetchUserRolesByUser: async () => [],
    writeUserRoleChanges: async () => ({ add: [], remove: [] }),
    setUserBanned: async () => undefined,
    fetchAllowlistView: async () => ({ allowAnyDomain: false, domains: [] }),
    replaceAllowlistDomains: async () => undefined,
    updateAllowAnyDomain: async () => undefined,
    ...overrides,
  };
}

describe("白名单管理读取", () => {
  it("鉴权前置：无 token 直接 401，不触白名单读取", async () => {
    const fetchAllowlistView = vi.fn();
    const result = await getAdminWhitelist(null, makeDeps({ fetchAllowlistView: fetchAllowlistView as never }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(fetchAllowlistView).not.toHaveBeenCalled();
  });

  it("鉴权前置：无「访问后台」权限点 403", async () => {
    const result = await getAdminWhitelist(
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => ["随时查看参考答案"] }),
    );
    expect(result).toEqual({ status: "forbidden" });
  });

  it("放行：返回含备注的完整管理视图", async () => {
    const view = { allowAnyDomain: true, domains: [{ domain: "cuc.edu.cn", note: "校内主域" }] };
    const result = await getAdminWhitelist("Bearer valid-token", makeDeps({ fetchAllowlistView: async () => view }));
    expect(result).toEqual({ status: "ok", ...view });
  });

  it("读取异常：500（error）", async () => {
    const result = await getAdminWhitelist(
      "Bearer valid-token",
      makeDeps({ fetchAllowlistView: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "error" });
  });
});

describe("域名清单全量保存", () => {
  it("鉴权前置：无 token 401，不触写入", async () => {
    const replaceAllowlistDomains = vi.fn();
    const result = await saveAdminWhitelistDomains([{ domain: "cuc.edu.cn" }], null, makeDeps({ replaceAllowlistDomains }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(replaceAllowlistDomains).not.toHaveBeenCalled();
  });

  it("放行：归一（去空白/转小写、备注透传）后全量下发", async () => {
    const replaceAllowlistDomains = vi.fn();
    const result = await saveAdminWhitelistDomains(
      [{ domain: " CUC.edu.cn ", note: "校内" }, { domain: "bfsu.edu.cn" }],
      "Bearer valid-token",
      makeDeps({ replaceAllowlistDomains }),
    );
    expect(result).toEqual({ status: "ok" });
    expect(replaceAllowlistDomains).toHaveBeenCalledWith([
      { domain: "cuc.edu.cn", note: "校内" },
      { domain: "bfsu.edu.cn", note: null },
    ]);
  });

  it("空清单可保存（全关时无人可注册，属合法配置）", async () => {
    const replaceAllowlistDomains = vi.fn();
    const result = await saveAdminWhitelistDomains([], "Bearer valid-token", makeDeps({ replaceAllowlistDomains }));
    expect(result).toEqual({ status: "ok" });
    expect(replaceAllowlistDomains).toHaveBeenCalledWith([]);
  });

  it("非法域名（空串 / 含 @ / 含空格）：invalid，不触写入", async () => {
    const replaceAllowlistDomains = vi.fn();
    for (const domain of ["", "a@cuc.edu.cn", "cuc .edu.cn"]) {
      const result = await saveAdminWhitelistDomains([{ domain }], "Bearer valid-token", makeDeps({ replaceAllowlistDomains }));
      expect(result).toEqual({ status: "invalid", error: "域名格式不正确" });
    }
    expect(replaceAllowlistDomains).not.toHaveBeenCalled();
  });

  it("重复域名去重（幂等语义）", async () => {
    const replaceAllowlistDomains = vi.fn();
    const result = await saveAdminWhitelistDomains(
      [{ domain: "cuc.edu.cn" }, { domain: "CUC.edu.cn", note: "重复" }],
      "Bearer valid-token",
      makeDeps({ replaceAllowlistDomains }),
    );
    expect(result).toEqual({ status: "ok" });
    expect(replaceAllowlistDomains).toHaveBeenCalledWith([{ domain: "cuc.edu.cn", note: null }]);
  });

  it("写入异常：error", async () => {
    const result = await saveAdminWhitelistDomains(
      [{ domain: "cuc.edu.cn" }],
      "Bearer valid-token",
      makeDeps({ replaceAllowlistDomains: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "error" });
  });
});

describe("总开关切换", () => {
  it("鉴权前置：无权限点 403，不触写入", async () => {
    const updateAllowAnyDomain = vi.fn();
    const result = await updateAdminWhitelistConfig(
      true,
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => [], updateAllowAnyDomain }),
    );
    expect(result).toEqual({ status: "forbidden" });
    expect(updateAllowAnyDomain).not.toHaveBeenCalled();
  });

  it("放行：下发目标开关值", async () => {
    const updateAllowAnyDomain = vi.fn();
    const result = await updateAdminWhitelistConfig(true, "Bearer valid-token", makeDeps({ updateAllowAnyDomain }));
    expect(result).toEqual({ status: "ok" });
    expect(updateAllowAnyDomain).toHaveBeenCalledWith(true);
  });

  it("写入异常：error", async () => {
    const result = await updateAdminWhitelistConfig(
      false,
      "Bearer valid-token",
      makeDeps({ updateAllowAnyDomain: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "error" });
  });
});
