// 后台用户列表纯函数（spec #41 / T2）：搜索词与页码归一、用户行合并。
// 边界穷举见 __tests__/admin-users.test.ts；账号禁用真源在云端认证服务的封禁。

/** profiles 分页行（service_role 查询结果的最小字段面） */
export interface AdminProfileRow {
  user_id: string;
  student_id: string | null;
  real_name: string | null;
  nickname: string | null;
  email: string | null;
  created_at: string | null;
}

/** user_roles 全量行（复合主键 user_id + role） */
export interface AdminRoleRow {
  user_id: string;
  role: string;
}

/** 合并后的用户行（API 响应与页面渲染共用） */
export interface AdminUserRow {
  userId: string;
  studentId: string | null;
  realName: string | null;
  nickname: string | null;
  email: string | null;
  /** 持有角色名列表（按数据库返回顺序） */
  roles: string[];
  /** 已被云端认证服务封禁 = 已禁用 */
  banned: boolean;
  createdAt: string | null;
}

/** 归一后的列表查询：search 为空 = 不筛选；page 从 1 起 */
export interface NormalizedUsersQuery {
  search: string;
  page: number;
}

/** 每页条数（spec：注册时间倒序、每页 20） */
export const ADMIN_USERS_PAGE_SIZE = 20;

/** 「管理员」角色名（数据值中文，ADR-0006）：自我保护判定与界面禁用态共用的常量 */
export const ADMIN_ROLE_NAME = "管理员";

/** 后台角色编辑的候选集（与 roles 表种子一致：学生/助教/教师/管理员；合法性以服务端查询为准） */
export const ADMIN_ROLE_CANDIDATES = ["学生", "助教", "教师", ADMIN_ROLE_NAME] as const;

/** 搜索词与页码归一：空白搜索词归空；页码非正整数/非法一律回落第 1 页 */
export function normalizeUsersQuery(raw: { q?: string | null; page?: string | null }): NormalizedUsersQuery {
  const search = (raw.q ?? "").trim();
  let page = 1;
  const parsed = Number.parseInt((raw.page ?? "").trim(), 10);
  if (Number.isSafeInteger(parsed) && parsed >= 1) page = parsed;
  return { search, page };
}

/** 「profiles 页 + 全量角色持有 + 封禁集合 → 用户行」合并：角色按 user_id 对齐（无记录=空），封禁按集合命中 */
export function mergeUserRows(
  profileRows: readonly AdminProfileRow[],
  roleRows: readonly AdminRoleRow[],
  bannedUserIds: ReadonlySet<string>,
): AdminUserRow[] {
  const rolesByUser = new Map<string, string[]>();
  for (const row of roleRows) {
    const list = rolesByUser.get(row.user_id);
    if (list) list.push(row.role);
    else rolesByUser.set(row.user_id, [row.role]);
  }
  return profileRows.map((profile) => ({
    userId: profile.user_id,
    studentId: profile.student_id,
    realName: profile.real_name,
    nickname: profile.nickname,
    email: profile.email,
    roles: rolesByUser.get(profile.user_id) ?? [],
    banned: bannedUserIds.has(profile.user_id),
    createdAt: profile.created_at,
  }));
}
