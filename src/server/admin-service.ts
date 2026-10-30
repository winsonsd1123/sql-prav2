// 后台管理服务（服务端，ADR-0007）：鉴权链共享收口 + 用户列表编排。
// 鉴权链：Authorization Bearer → 云端认证验明身份 → service_role 查权限点并集 → 持「访问后台」放行；
// 无/坏 token 401（unauthorized），无权限点 403（forbidden）。全部 /api/admin/* 路由复用，route 薄壳不含鉴权细节。
// 外部依赖（token 验证、数据库、认证管理 API）经 AdminDeps 注入（照 LoginDeps 模式），只测编排不测网络层。
import { serverAnonClient, serverPrivilegedClient } from "@/lib/supabase/server-client";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import {
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

/** 白名单域名条目（管理视图含备注；备注可空） */
export interface AdminWhitelistDomain {
  domain: string;
  note: string | null;
}

/** 白名单管理视图：总开关 + 域名清单（含备注，供管理页展示现状） */
export interface AdminWhitelistView {
  allowAnyDomain: boolean;
  domains: AdminWhitelistDomain[];
}

export type AdminWhitelistResult =
  | ({ status: "ok" } & AdminWhitelistView)
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid"; error: string }
  | { status: "error" };

export type AdminWhitelistSaveResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid"; error: string }
  | { status: "error" };

/** 可注入依赖（测试接缝）：token 验证 / 权限并集 / profiles 分页 / 全量角色 / 封禁集合 / 白名单读写 */
export interface AdminDeps {
  verifyAccessToken(token: string): Promise<{ userId: string } | null>;
  fetchUserPermissions(userId: string): Promise<string[]>;
  fetchProfilePage(query: { search: string; page: number; pageSize: number }): Promise<{ rows: AdminProfileRow[]; total: number }>;
  fetchAllUserRoles(): Promise<AdminRoleRow[]>;
  fetchBannedUserIds(): Promise<Set<string>>;
  fetchAllowlistView(): Promise<AdminWhitelistView>;
  replaceAllowlistDomains(domains: AdminWhitelistDomain[]): Promise<void>;
  updateAllowAnyDomain(allowAnyDomain: boolean): Promise<void>;
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

  // 白名单管理视图（service_role）：singleton 总开关 + 域名清单（含备注），域名按字典序稳定展示
  fetchAllowlistView: async () => {
    const client = serverPrivilegedClient();
    const [configResult, domainResult] = await Promise.all([
      client.from("email_allowlist_config").select("allow_any_domain").eq("singleton", true).maybeSingle(),
      client.from("email_allowlist_domains").select("domain,note").order("domain"),
    ]);
    return {
      allowAnyDomain: (configResult.data as { allow_any_domain: boolean } | null)?.allow_any_domain ?? false,
      domains: (domainResult.data ?? []) as AdminWhitelistDomain[],
    };
  },

  // 全量替换域名清单（幂等）：先清空再写入新清单（PostgREST 无事务，两步串行；失败抛错由编排层兜底为 500）
  replaceAllowlistDomains: async (domains) => {
    const client = serverPrivilegedClient();
    const { error: deleteError } = await client.from("email_allowlist_domains").delete().neq("domain", "");
    if (deleteError) throw new Error(deleteError.message);
    if (domains.length === 0) return;
    const { error: insertError } = await client.from("email_allowlist_domains").insert(
      domains.map((entry) => ({ domain: entry.domain, note: entry.note })),
    );
    if (insertError) throw new Error(insertError.message);
  },

  // 切换「放开任意域名注册」总开关（singleton 行 upsert）
  updateAllowAnyDomain: async (allowAnyDomain) => {
    const { error } = await serverPrivilegedClient()
      .from("email_allowlist_config")
      .upsert({ singleton: true, allow_any_domain: allowAnyDomain });
    if (error) throw new Error(error.message);
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

/** 域名归一：去首尾空白、转小写；空串 / 含 @ / 内含空白视为非法返回 null */
function normalizeDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase();
  if (domain === "" || domain.includes("@") || /\s/.test(domain)) return null;
  return domain;
}

/** 白名单管理视图读取：鉴权前置 → 读总开关与域名清单（含备注） */
export async function getAdminWhitelist(
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminWhitelistResult> {
  const auth = await authorizeAdminRequest(authorization, deps);
  if (auth.status !== "ok") return auth;
  try {
    const view = await deps.fetchAllowlistView();
    return { status: "ok", ...view };
  } catch {
    return { status: "error" };
  }
}

/** 域名清单全量保存（幂等）：鉴权前置 → 归一与校验 → 全量替换；空清单合法（全关时无人可注册） */
export async function saveAdminWhitelistDomains(
  rawDomains: { domain: string; note?: string | null }[],
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminWhitelistSaveResult> {
  const auth = await authorizeAdminRequest(authorization, deps);
  if (auth.status !== "ok") return auth;

  const normalized = new Map<string, string | null>();
  for (const entry of rawDomains) {
    const domain = normalizeDomain(entry.domain);
    if (domain === null) return { status: "invalid", error: "域名格式不正确" };
    // 重复条目以首见为准（幂等语义：同一域名只落一行）
    if (!normalized.has(domain)) normalized.set(domain, entry.note?.trim() ? entry.note.trim() : null);
  }
  try {
    await deps.replaceAllowlistDomains([...normalized.entries()].map(([domain, note]) => ({ domain, note })));
    return { status: "ok" };
  } catch {
    return { status: "error" };
  }
}

/** 总开关切换：鉴权前置 → 更新 allow_any_domain（singleton） */
export async function updateAdminWhitelistConfig(
  allowAnyDomain: boolean,
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminWhitelistSaveResult> {
  const auth = await authorizeAdminRequest(authorization, deps);
  if (auth.status !== "ok") return auth;
  try {
    await deps.updateAllowAnyDomain(allowAnyDomain);
    return { status: "ok" };
  } catch {
    return { status: "error" };
  }
}
