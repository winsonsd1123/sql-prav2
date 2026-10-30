// 后台管理服务（服务端，ADR-0007）：鉴权链共享收口 + 用户列表编排。
// 鉴权链：Authorization Bearer → 云端认证验明身份 → service_role 查权限点并集 → 持「访问后台」放行；
// 无/坏 token 401（unauthorized），无权限点 403（forbidden）。全部 /api/admin/* 路由复用，route 薄壳不含鉴权细节。
// 外部依赖（token 验证、数据库、认证管理 API）经 AdminDeps 注入（照 LoginDeps 模式），只测编排不测网络层。
import { serverAnonClient, serverPrivilegedClient } from "@/lib/supabase/server-client";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import {
  ADMIN_ROLE_NAME,
  ADMIN_USERS_PAGE_SIZE,
  mergeUserRows,
  normalizeUsersQuery,
  type AdminProfileRow,
  type AdminRoleRow,
  type AdminUserRow,
} from "@/lib/admin-users";

// 行类型随纯函数模块定义，此处透出供服务层测试与消费方引用
export type { AdminProfileRow, AdminRoleRow, AdminUserRow } from "@/lib/admin-users";

export type AdminAuthResult =
  | { status: "ok"; userId: string }  | { status: "unauthorized" }
  | { status: "forbidden" };

export type AdminUsersResult =
  | { status: "ok"; users: AdminUserRow[]; total: number; page: number; pageSize: number }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "error" };

export type AdminSetRolesResult =
  | { status: "ok"; roles: string[] }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_roles" }
  | { status: "self_protection" }
  | { status: "error" };

/** 可注入依赖（测试接缝）：token 验证 / 权限并集 / profiles 分页 / 全量角色 / 封禁集合 / 角色合法集 / 角色写入 */
export interface AdminDeps {
  verifyAccessToken(token: string): Promise<{ userId: string } | null>;
  fetchUserPermissions(userId: string): Promise<string[]>;
  fetchProfilePage(query: { search: string; page: number; pageSize: number }): Promise<{ rows: AdminProfileRow[]; total: number }>;
  fetchAllUserRoles(): Promise<AdminRoleRow[]>;
  fetchBannedUserIds(): Promise<Set<string>>;
  fetchValidRoleNames(): Promise<string[]>;
  fetchUserRolesByUser(userId: string): Promise<string[]>;
  writeUserRoleChanges(userId: string, changes: { add: string[]; remove: string[] }): Promise<{ add: string[]; remove: string[] }>;
}

/** 从 Authorization 头提取 Bearer token；非 Bearer 方案或空 token 返回 null */
export function extractBearerToken(authorization: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export const defaultAdminDeps: AdminDeps = {
  // 云端认证验明 token 与身份（anon 客户端即可；有效性由认证服务裁决）
  verifyAccessToken: async (token) => {
    const { data, error } = await serverAnonClient().auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id };
  },

  // service_role 查该用户 user_roles → role_permissions 权限点并集（绕过「仅本人可读」RLS）
  fetchUserPermissions: async (userId) => {
    const client = serverPrivilegedClient();
    const rolesResult = await client.from("user_roles").select("role").eq("user_id", userId);
    const roleList = ((rolesResult.data ?? []) as { role: string }[]).map((row) => row.role);
    if (roleList.length === 0) return [];
    const permissionsResult = await client.from("role_permissions").select("permission").in("role", roleList);
    return [...new Set(((permissionsResult.data ?? []) as { permission: string }[]).map((row) => row.permission))];
  },

  // profiles 分页：注册时间倒序 + 单框模糊搜索（学号/姓名/昵称/邮箱 OR ilike），count 精确
  fetchProfilePage: async ({ search, page, pageSize }) => {
    let query = serverPrivilegedClient()
      .from("profiles")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (search) {
      // postgrest or= 语法：逗号分隔，搜索词内的逗号/百分号需转义
      const escaped = search.replace(/[,()%]/g, "\\$&");
      const like = `*${escaped}*`;
      query = query.or(`student_id.ilike.${like},real_name.ilike.${like},nickname.ilike.${like},email.ilike.${like}`);
    }
    const { data, count } = await query;
    return { rows: (data ?? []) as AdminProfileRow[], total: count ?? 0 };
  },

  // 全量角色持有（service_role；供当前页用户行合并）
  fetchAllUserRoles: async () => {
    const { data } = await serverPrivilegedClient().from("user_roles").select("user_id,role");
    return (data ?? []) as AdminRoleRow[];
  },

  // 认证服务封禁状态（账号禁用真源）：banned_until 晚于当前时刻 = 已禁用
  fetchBannedUserIds: async () => {
    const { data } = await serverPrivilegedClient().auth.admin.listUsers();
    const banned = new Set<string>();
    for (const user of data?.users ?? []) {
      const until = user.banned_until ? Date.parse(user.banned_until) : NaN;
      if (!Number.isNaN(until) && until > Date.now()) banned.add(user.id);
    }
    return banned;
  },

  // 角色合法集（roles 表 name 主键；service_role 读）
  fetchValidRoleNames: async () => {
    const { data } = await serverPrivilegedClient().from("roles").select("name");
    return ((data ?? []) as { name: string }[]).map((row) => row.name);
  },

  // 指定用户现有角色（service_role 读，供差集计算）
  fetchUserRolesByUser: async (userId) => {
    const { data } = await serverPrivilegedClient().from("user_roles").select("role").eq("user_id", userId);
    return ((data ?? []) as { role: string }[]).map((row) => row.role);
  },

  // 差集落库（service_role 写）：先删后增；on conflict do nothing 保证幂等，重提交零脏数据
  writeUserRoleChanges: async (userId, { add, remove }) => {
    const client = serverPrivilegedClient();
    if (remove.length > 0) await client.from("user_roles").delete().eq("user_id", userId).in("role", remove);
    if (add.length > 0) await client.from("user_roles").insert(add.map((role) => ({ user_id: userId, role })));
    return { add, remove };
  },
};

/** 鉴权链（共享收口，全部管理 API 复用）：Bearer → 验明身份 → 权限并集 → 持「访问后台」放行 */
export async function authorizeAdminRequest(
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminAuthResult> {
  const token = extractBearerToken(authorization);
  if (!token) return { status: "unauthorized" };
  const identity = await deps.verifyAccessToken(token);
  if (!identity) return { status: "unauthorized" };
  try {
    const permissions = await deps.fetchUserPermissions(identity.userId);
    if (!hasPermission(permissions, PERMISSIONS.adminConsole)) return { status: "forbidden" };
  } catch {
    // 权限查询失败：按无权限处理（安全默认），不区分 500 与 403 以免泄露服务状态
    return { status: "forbidden" };
  }
  return { status: "ok", userId: identity.userId };
}

/** 用户列表编排：鉴权前置 → 归一查询 → 分页查档案 + 全量角色 + 封禁集合 → 合并用户行 */
export async function listAdminUsers(
  rawQuery: { q?: string | null; page?: string | null },
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminUsersResult> {
  const auth = await authorizeAdminRequest(authorization, deps);
  if (auth.status !== "ok") return auth;

  const { search, page } = normalizeUsersQuery(rawQuery);
  try {
    const [{ rows, total }, roleRows, bannedUserIds] = await Promise.all([
      deps.fetchProfilePage({ search, page, pageSize: ADMIN_USERS_PAGE_SIZE }),
      deps.fetchAllUserRoles(),
      deps.fetchBannedUserIds(),
    ]);
    return {
      status: "ok",
      users: mergeUserRows(rows, roleRows, bannedUserIds),
      total,
      page,
      pageSize: ADMIN_USERS_PAGE_SIZE,
    };
  } catch {
    return { status: "error" };
  }
}

/** 角色全量设置编排（T3，spec #41）：鉴权前置 → 载荷与角色合法集校验 → 自我保护 → 差集增删。
 *  全量语义：roles 为目标用户应有的完整角色集合，按现有差集增删 user_roles，重复提交幂等。
 *  自我保护（ADR-0007）：操作者==目标用户且新集合不含「管理员」→ 服务端强制拒绝，不落库。 */
export async function setAdminUserRoles(
  targetUserId: string,
  roles: unknown,
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminSetRolesResult> {
  const auth = await authorizeAdminRequest(authorization, deps);
  if (auth.status !== "ok") return auth;

  // 载荷归一：仅接受字符串数组；trim 后去重（保持首次出现顺序）
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string")) {
    return { status: "invalid_roles" };
  }
  const requested = [...new Set((roles as string[]).map((role) => role.trim()))];

  const validRoleNames: ReadonlySet<string> = new Set(await deps.fetchValidRoleNames());
  if (requested.some((role) => !validRoleNames.has(role))) return { status: "invalid_roles" };

  // 自我保护：不能回收自己的「管理员」角色（体验层禁用之外的服务端强制）
  if (auth.userId === targetUserId && !requested.includes(ADMIN_ROLE_NAME)) {
    return { status: "self_protection" };
  }

  try {
    const existing = new Set(await deps.fetchUserRolesByUser(targetUserId));
    const add = requested.filter((role) => !existing.has(role));
    const remove = [...existing].filter((role) => !requested.includes(role));
    await deps.writeUserRoleChanges(targetUserId, { add, remove });
    return { status: "ok", roles: requested };
  } catch {
    return { status: "error" };
  }
}
