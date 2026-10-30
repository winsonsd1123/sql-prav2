import { describe, expect, it } from "vitest";
import { mergeUserRows, normalizeUsersQuery, type AdminProfileRow, type AdminRoleRow } from "@/lib/admin-users";

// 边界穷举：搜索词/页码归一 × 用户行合并（角色对齐、封禁对齐、空/越界页）
// 用户行期望值来自手排样例（独立于实现的真源），非复算。

describe("搜索词与页码归一", () => {
  it("缺省：空搜索、第 1 页", () => {
    expect(normalizeUsersQuery({})).toEqual({ search: "", page: 1 });
  });

  it("搜索词去首尾空白（内部空白保留）", () => {
    expect(normalizeUsersQuery({ q: "  张三 " })).toEqual({ search: "张三", page: 1 });
    expect(normalizeUsersQuery({ q: "zhang 01" })).toEqual({ search: "zhang 01", page: 1 });
  });

  it("纯空白搜索词归一为空（= 不筛选）", () => {
    expect(normalizeUsersQuery({ q: "   " }).search).toBe("");
  });

  it("页码：合法数字字符串照取", () => {
    expect(normalizeUsersQuery({ q: "", page: "3" }).page).toBe(3);
  });

  it("页码越界与非法输入一律回落第 1 页", () => {
    for (const page of ["0", "-1", "1.5", "abc", "", null, undefined, "999999999999999999999"]) {
      expect(normalizeUsersQuery({ q: "", page: page as string | null | undefined }).page).toBe(1);
    }
  });

  it("页码带空白与加号的数字字符串仍可解析", () => {
    expect(normalizeUsersQuery({ page: " 2 " }).page).toBe(2);
    expect(normalizeUsersQuery({ page: "+2" }).page).toBe(2);
  });

  it("q 为 null/undefined 不抛错", () => {
    expect(normalizeUsersQuery({ q: null, page: "2" })).toEqual({ search: "", page: 2 });
  });
});

const profiles: AdminProfileRow[] = [
  { user_id: "u1", student_id: "2022110001", real_name: "张三", nickname: "三三", email: "zhang@cuc.edu.cn", created_at: "2026-10-02T10:00:00Z" },
  { user_id: "u2", student_id: "2022110002", real_name: "李四", nickname: null, email: "li@cuc.edu.cn", created_at: "2026-10-01T10:00:00Z" },
];
const roles: AdminRoleRow[] = [
  { user_id: "u1", role: "学生" },
  { user_id: "u1", role: "助教" },
  { user_id: "u2", role: "学生" },
];

describe("用户行合并（profiles 页 + 角色持有 + 封禁状态）", () => {
  it("角色按 user_id 对齐：u1 得两个角色，u2 得一个", () => {
    const rows = mergeUserRows(profiles, roles, new Set());
    expect(rows.map((r) => ({ id: r.userId, roles: r.roles }))).toEqual([
      { id: "u1", roles: ["学生", "助教"] },
      { id: "u2", roles: ["学生"] },
    ]);
  });

  it("角色表无记录的用户：角色为空数组（不因缺记录报错）", () => {
    const rows = mergeUserRows(profiles, [], new Set());
    expect(rows.every((r) => r.roles)).toBe(true);
    expect(rows[0].roles).toEqual([]);
  });

  it("角色表含他人记录不串行（多余 user_id 忽略）", () => {
    const rows = mergeUserRows([profiles[0]], [...roles, { user_id: "u9", role: "管理员" }], new Set());
    expect(rows[0].roles).toEqual(["学生", "助教"]);
  });

  it("封禁集合命中：banned 为真；未命中的保持正常", () => {
    const rows = mergeUserRows(profiles, roles, new Set(["u2"]));
    expect(rows.map((r) => r.banned)).toEqual([false, true]);
  });

  it("封禁集合包含无档案用户：不影响输出", () => {
    const rows = mergeUserRows(profiles, roles, new Set(["u9"]));
    expect(rows.map((r) => r.banned)).toEqual([false, false]);
  });

  it("档案字段原样落位（昵称可为空）", () => {
    const rows = mergeUserRows(profiles, roles, new Set());
    expect(rows[1]).toMatchObject({
      studentId: "2022110002",
      realName: "李四",
      nickname: null,
      email: "li@cuc.edu.cn",
      createdAt: "2026-10-01T10:00:00Z",
    });
  });

  it("空页（profiles 为空）：输出空数组", () => {
    expect(mergeUserRows([], roles, new Set(["u1"]))).toEqual([]);
  });

  it("越界页同样表现为空页（由调用方传入空 profiles，本函数只负责合并）", () => {
    expect(mergeUserRows([], [], new Set())).toEqual([]);
  });
});
