// 接缝：知识点词表管理服务（issue #79 / spec #75，ADR 0010）——注入假的 token 验证/权限/词表读写，
// 只测鉴权前置（访问后台 + 知识点词表管理双权限点）、归一校验与 CRUD/启停落库编排，不触网络层。
// 照白名单管理服务测试模式：makeDeps 工厂 + 行为断言。
import { describe, expect, it, vi } from "vitest";
import {
  listKnowledgeAreas,
  createKnowledgeArea,
  updateKnowledgeArea,
  deleteKnowledgeArea,
  setKnowledgeAreaActive,
  type AdminDeps,
  type AdminKnowledgeAreaEntry,
} from "@/server/admin-service";

function makeDeps(overrides: Partial<AdminDeps> = {}): AdminDeps {
  return {
    verifyAccessToken: async (token) => (token === "valid-token" ? { userId: "teacher-1" } : null),
    fetchUserPermissions: async () => ["访问后台", "知识点词表管理"],
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
    fetchExposedPackIds: async () => [],
    replaceExposedPackIds: async () => undefined,
    // #79 新增接缝：词表读写（本文件各用例按需 override）
    fetchKnowledgeAreas: async () => [],
    insertKnowledgeArea: async () => ({ status: "ok", id: "ka-1" }),
    updateKnowledgeArea: async () => "updated",
    deleteKnowledgeArea: async () => "deleted",
    setKnowledgeAreaActive: async () => "updated",
    ...overrides,
  };
}

const sampleEntries: AdminKnowledgeAreaEntry[] = [
  { id: "ka-1", name: "单表查询与投影", description: "SELECT 列投影", active: true },
  { id: "ka-2", name: "子查询", description: "", active: false },
];

describe("词表列表读取", () => {
  it("鉴权前置：无 token 401，不触词表读取", async () => {
    const fetchKnowledgeAreas = vi.fn();
    const result = await listKnowledgeAreas(null, makeDeps({ fetchKnowledgeAreas: fetchKnowledgeAreas as never }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(fetchKnowledgeAreas).not.toHaveBeenCalled();
  });

  it("无双权限点被拦：有「访问后台」但无「知识点词表管理」→ 403，不触词表读取", async () => {
    const fetchKnowledgeAreas = vi.fn();
    const result = await listKnowledgeAreas(
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => ["访问后台"], fetchKnowledgeAreas: fetchKnowledgeAreas as never }),
    );
    expect(result).toEqual({ status: "forbidden" });
    expect(fetchKnowledgeAreas).not.toHaveBeenCalled();
  });

  it("放行：返回全量条目（含停用态）", async () => {
    const result = await listKnowledgeAreas("Bearer valid-token", makeDeps({ fetchKnowledgeAreas: async () => sampleEntries }));
    expect(result).toEqual({ status: "ok", entries: sampleEntries });
  });

  it("读取异常：500（error）", async () => {
    const result = await listKnowledgeAreas(
      "Bearer valid-token",
      makeDeps({ fetchKnowledgeAreas: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "error" });
  });
});

describe("词表条目创建", () => {
  it("鉴权前置：无 token 401，不触写入", async () => {
    const insertKnowledgeArea = vi.fn();
    const result = await createKnowledgeArea("聚合与分组", "", null, makeDeps({ insertKnowledgeArea: insertKnowledgeArea as never }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(insertKnowledgeArea).not.toHaveBeenCalled();
  });

  it("归一校验：名称去空白后为空 → invalid，不触写入", async () => {
    const insertKnowledgeArea = vi.fn();
    const result = await createKnowledgeArea("  ", "描述", "Bearer valid-token", makeDeps({ insertKnowledgeArea: insertKnowledgeArea as never }));
    expect(result.status).toBe("invalid");
    expect(insertKnowledgeArea).not.toHaveBeenCalled();
  });

  it("放行：归一（trim）后落库并返回新条目 id", async () => {
    const insertKnowledgeArea = vi.fn().mockResolvedValue({ status: "ok", id: "ka-9" });
    const result = await createKnowledgeArea(" 日期函数 ", " 日期相关函数 ", "Bearer valid-token", makeDeps({ insertKnowledgeArea: insertKnowledgeArea as never }));
    expect(result).toEqual({ status: "ok", id: "ka-9" });
    expect(insertKnowledgeArea).toHaveBeenCalledWith({ name: "日期函数", description: "日期相关函数" });
  });

  it("重名冲突：duplicate_name（400 载荷），不当作服务异常", async () => {
    const result = await createKnowledgeArea(
      "子查询",
      "",
      "Bearer valid-token",
      makeDeps({ insertKnowledgeArea: async () => ({ status: "duplicate" }) }),
    );
    expect(result).toEqual({ status: "duplicate_name" });
  });

  it("落库异常：500（error）", async () => {
    const result = await createKnowledgeArea(
      "新条目",
      "",
      "Bearer valid-token",
      makeDeps({ insertKnowledgeArea: async () => { throw new Error("db down"); } }),
    );
    expect(result).toEqual({ status: "error" });
  });
});

describe("词表条目编辑", () => {
  it("鉴权前置：无「知识点词表管理」权限点 403，不触写入", async () => {
    const updateDep = vi.fn();
    const result = await updateKnowledgeArea(
      "ka-1",
      { name: "改名", description: "" },
      "Bearer valid-token",
      makeDeps({ fetchUserPermissions: async () => ["访问后台"], updateKnowledgeArea: updateDep as never }),
    );
    expect(result).toEqual({ status: "forbidden" });
    expect(updateDep).not.toHaveBeenCalled();
  });

  it("归一校验：名称去空白后为空 → invalid", async () => {
    const result = await updateKnowledgeArea("ka-1", { name: " ", description: "x" }, "Bearer valid-token", makeDeps());
    expect(result.status).toBe("invalid");
  });

  it("放行：归一后更新；条目不存在 → not_found", async () => {
    const updateDep = vi.fn().mockResolvedValue("updated");
    const result = await updateKnowledgeArea(
      "ka-1",
      { name: " 多表 JOIN ", description: "连接查询" },
      "Bearer valid-token",
      makeDeps({ updateKnowledgeArea: updateDep as never }),
    );
    expect(result).toEqual({ status: "ok" });
    expect(updateDep).toHaveBeenCalledWith("ka-1", { name: "多表 JOIN", description: "连接查询" });

    const missing = await updateKnowledgeArea(
      "ka-404",
      { name: "改名", description: "" },
      "Bearer valid-token",
      makeDeps({ updateKnowledgeArea: async () => "not_found" }),
    );
    expect(missing).toEqual({ status: "not_found" });
  });

  it("重名冲突：duplicate_name", async () => {
    const result = await updateKnowledgeArea("ka-1", { name: "子查询", description: "" }, "Bearer valid-token", makeDeps({ updateKnowledgeArea: async () => "duplicate" }));
    expect(result).toEqual({ status: "duplicate_name" });
  });
});

describe("词表条目删除", () => {
  it("鉴权前置：无 token 401，不触删除", async () => {
    const deleteDep = vi.fn();
    const result = await deleteKnowledgeArea("ka-1", null, makeDeps({ deleteKnowledgeArea: deleteDep as never }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(deleteDep).not.toHaveBeenCalled();
  });

  it("放行：物理删除；条目不存在 → not_found", async () => {
    const deleteDep = vi.fn().mockResolvedValue("deleted");
    const result = await deleteKnowledgeArea("ka-2", "Bearer valid-token", makeDeps({ deleteKnowledgeArea: deleteDep as never }));
    expect(result).toEqual({ status: "ok" });
    expect(deleteDep).toHaveBeenCalledWith("ka-2");

    const missing = await deleteKnowledgeArea("ka-404", "Bearer valid-token", makeDeps({ deleteKnowledgeArea: async () => "not_found" }));
    expect(missing).toEqual({ status: "not_found" });
  });
});

describe("词表条目启停", () => {
  it("鉴权前置：无 token 401，不触写入", async () => {
    const setActiveDep = vi.fn();
    const result = await setKnowledgeAreaActive("ka-1", false, null, makeDeps({ setKnowledgeAreaActive: setActiveDep as never }));
    expect(result).toEqual({ status: "unauthorized" });
    expect(setActiveDep).not.toHaveBeenCalled();
  });

  it("载荷校验：active 非布尔 → invalid", async () => {
    const result = await setKnowledgeAreaActive("ka-1", "yes" as never, "Bearer valid-token", makeDeps());
    expect(result.status).toBe("invalid");
  });

  it("放行：停用/启用落库；条目不存在 → not_found", async () => {
    const setActiveDep = vi.fn().mockResolvedValue("updated");
    const result = await setKnowledgeAreaActive("ka-1", false, "Bearer valid-token", makeDeps({ setKnowledgeAreaActive: setActiveDep as never }));
    expect(result).toEqual({ status: "ok", active: false });
    expect(setActiveDep).toHaveBeenCalledWith("ka-1", false);

    const missing = await setKnowledgeAreaActive("ka-404", true, "Bearer valid-token", makeDeps({ setKnowledgeAreaActive: async () => "not_found" }));
    expect(missing).toEqual({ status: "not_found" });
  });
});
