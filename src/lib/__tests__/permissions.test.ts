import { describe, expect, it } from "vitest";
import { PERMISSIONS, mergePermissions, hasPermission, EMPTY_PERMISSIONS } from "@/lib/permissions";

describe("权限点判定（多角色并集，ADR-0005）", () => {
  it("权限点常量含「随时查看参考答案」与三个占位（编辑题库/安排练习/查看学情）", () => {
    expect(PERMISSIONS.viewAnswersAnytime).toBe("随时查看参考答案");
    expect(PERMISSIONS.editQuestionBank).toBe("编辑题库");
    expect(PERMISSIONS.assignPractice).toBe("安排练习");
    expect(PERMISSIONS.viewAnalytics).toBe("查看学情");
  });

  it("多角色权限取并集：学生+助教 → 助教的「随时查看参考答案」并入", () => {
    const studentPermissions: string[] = [];
    const taPermissions = [PERMISSIONS.viewAnswersAnytime];
    const set = mergePermissions([studentPermissions, taPermissions]);
    expect(hasPermission(set, PERMISSIONS.viewAnswersAnytime)).toBe(true);
  });

  it("任一角色持有即放行（并集语义，不要求全部角色）", () => {
    const set = mergePermissions([[], [PERMISSIONS.viewAnswersAnytime], []]);
    expect(hasPermission(set, PERMISSIONS.viewAnswersAnytime)).toBe(true);
  });

  it("无角色 → 空集合，任何权限点（含占位）都不放行（安全默认：走摩擦力）", () => {
    const set = mergePermissions([]);
    expect(set.size).toBe(0);
    for (const permission of Object.values(PERMISSIONS)) {
      expect(hasPermission(set, permission)).toBe(false);
    }
  });

  it("重复权限点（多角色挂同一权限点）不放大集合", () => {
    const singleRole = mergePermissions([[PERMISSIONS.viewAnswersAnytime]]);
    const duplicated = mergePermissions([
      [PERMISSIONS.viewAnswersAnytime],
      [PERMISSIONS.viewAnswersAnytime, PERMISSIONS.viewAnswersAnytime],
    ]);
    expect(duplicated.size).toBe(1);
    expect(hasPermission(duplicated, PERMISSIONS.viewAnswersAnytime)).toBe(true);
    expect(duplicated).toEqual(singleRole);
  });

  it("占位权限点（编辑题库等）未挂角色时不可凭空持有；挂上后按数据放行", () => {
    const unmounted = mergePermissions([[], []]);
    expect(hasPermission(unmounted, PERMISSIONS.editQuestionBank)).toBe(false);
    const mounted = mergePermissions([[PERMISSIONS.editQuestionBank, PERMISSIONS.viewAnalytics]]);
    expect(hasPermission(mounted, PERMISSIONS.editQuestionBank)).toBe(true);
    expect(hasPermission(mounted, PERMISSIONS.viewAnalytics)).toBe(true);
    expect(hasPermission(mounted, PERMISSIONS.assignPractice)).toBe(false);
  });

  it("未知权限点（未命名进常量的）不因集合非空而误判持有", () => {
    const set = mergePermissions([[PERMISSIONS.viewAnswersAnytime]]);
    expect(hasPermission(set, "不存在的权限点")).toBe(false);
  });

  it("空权限集合常量：数组与 Set 两种入参形态判定一致", () => {
    expect(EMPTY_PERMISSIONS.size).toBe(0);
    expect(hasPermission([], PERMISSIONS.viewAnswersAnytime)).toBe(false);
    expect(hasPermission(EMPTY_PERMISSIONS, PERMISSIONS.viewAnswersAnytime)).toBe(false);
  });
});
