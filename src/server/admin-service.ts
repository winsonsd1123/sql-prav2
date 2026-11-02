// 后台管理服务（服务端，ADR-0007）：鉴权链共享收口 + 用户列表编排。
// 鉴权链：Authorization Bearer → 云端认证验明身份 → service_role 查权限点并集 → 持「访问后台」放行；
// 无/坏 token 401（unauthorized），无权限点 403（forbidden）。全部 /api/admin/* 路由复用，route 薄壳不含鉴权细节。
// 外部依赖（token 验证、数据库、认证管理 API）经 AdminDeps 注入（照 LoginDeps 模式），只测编排不测网络层。
import { serverAnonClient, serverPrivilegedClient } from "@/lib/supabase/server-client";
import { PERMISSIONS, hasPermission, mergePermissions } from "@/lib/permissions";
import {
  ADMIN_USERS_PAGE_SIZE,
  mapProfileRow,
  mergeUserRows,
  normalizeUsersQuery,
  type AdminProfileRow,
  type AdminRoleRow,
  type AdminUserRow,
  type ProfileRestRow,
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

export type AdminSetBanResult =
  | { status: "ok"; banned: boolean }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_banned" }
  | { status: "self_protection" }
  | { status: "error" };

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

/** 域包放出清单读取（#55，spec #53 目标③）：packIds 为当前放出的域包 id 全量列表 */
export type AdminPackExposureResult =
  | { status: "ok"; packIds: string[] }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "error" };

/** 域包放出清单全量保存（幂等；空清单合法 = 全不放） */
export type AdminSavePackExposureResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | { status: "error" };

/** 知识点词表条目（#79 / spec #75，ADR 0010）：名称 + 描述 + 启停态 */
export interface AdminKnowledgeAreaEntry {
  id: string;
  name: string;
  description: string;
  active: boolean;
}

/** 词表列表读取 */
export type AdminKnowledgeAreaListResult =
  | { status: "ok"; entries: AdminKnowledgeAreaEntry[] }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "error" };

/** 词表各写路径的精确失败集（鉴权态由 AdminAuthResult 透传形状复述）：重名冲突与条目不存在单独成态，不与 500 混淆 */
type KnowledgeAreaAuthFailure = { status: "unauthorized" } | { status: "forbidden" };

/** 创建：成功携带新条目 id；失败不含 not_found（新建无目标行） */
export type AdminKnowledgeAreaCreateResult =
  | { status: "ok"; id: string }
  | KnowledgeAreaAuthFailure
  | { status: "invalid" }
  | { status: "duplicate_name" }
  | { status: "error" };

/** 编辑：成功无载荷；名称唯一冲突与条目不存在都可能 */
export type AdminKnowledgeAreaUpdateResult =
  | { status: "ok" }
  | KnowledgeAreaAuthFailure
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "duplicate_name" }
  | { status: "error" };

/** 删除（物理删除）：载荷只有 id，无 invalid / 重名态 */
export type AdminKnowledgeAreaDeleteResult =
  | { status: "ok" }
  | KnowledgeAreaAuthFailure
  | { status: "not_found" }
  | { status: "error" };

/** 启停：成功携带最新启停态；无重名态 */
export type AdminKnowledgeAreaActiveResult =
  | { status: "ok"; active: boolean }
  | KnowledgeAreaAuthFailure
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "error" };

/** 词表接缝层结果：落库区分重名冲突（unique 违例）与成功；异常上抛由编排层兜底 500 */
export type KnowledgeAreaWriteOutcome = "updated" | "deleted" | "not_found" | "duplicate";

/** 可注入依赖（测试接缝）：token 验证 / 权限并集 / profiles 分页 / 全量角色 / 封禁集合 / 角色读写 / 认证封禁写入 / 白名单读写 / 域包放出清单读写 / 知识点词表读写 */
export interface AdminDeps {
  verifyAccessToken(token: string): Promise<{ userId: string } | null>;
  fetchUserPermissions(userId: string): Promise<string[]>;
  fetchProfilePage(query: { search: string; page: number; pageSize: number }): Promise<{ rows: AdminProfileRow[]; total: number }>;
  fetchAllUserRoles(): Promise<AdminRoleRow[]>;
  fetchBannedUserIds(): Promise<Set<string>>;
  fetchValidRoleNames(): Promise<string[]>;
  fetchRolePermissions(roles: string[]): Promise<string[][]>;
  fetchUserRolesByUser(userId: string): Promise<string[]>;
  writeUserRoleChanges(userId: string, changes: { add: string[]; remove: string[] }): Promise<{ add: string[]; remove: string[] }>;
  setUserBanned(userId: string, banned: boolean): Promise<void>;
  fetchAllowlistView(): Promise<AdminWhitelistView>;
  replaceAllowlistDomains(domains: AdminWhitelistDomain[]): Promise<void>;
  updateAllowAnyDomain(allowAnyDomain: boolean): Promise<void>;
  fetchExposedPackIds(): Promise<string[]>;
  replaceExposedPackIds(packIds: string[]): Promise<void>;
  fetchKnowledgeAreas(): Promise<AdminKnowledgeAreaEntry[]>;
  insertKnowledgeArea(entry: { name: string; description: string }): Promise<{ status: "ok"; id: string } | { status: "duplicate" }>;
  updateKnowledgeArea(id: string, entry: { name: string; description: string }): Promise<KnowledgeAreaWriteOutcome>;
  deleteKnowledgeArea(id: string): Promise<KnowledgeAreaWriteOutcome>;
  setKnowledgeAreaActive(id: string, active: boolean): Promise<KnowledgeAreaWriteOutcome>;
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

  // profiles 分页：注册时间倒序 + 单框模糊搜索（学号/姓名/昵称/邮箱 OR ilike），count 精确。
  // 列名照 PostgREST 真实形状（主键 id），经 mapProfileRow 归位 user_id——不许 as 直转契约类型。
  fetchProfilePage: async ({ search, page, pageSize }) => {
    let query = serverPrivilegedClient()
      .from("profiles")
      .select("id,student_id,real_name,nickname,email,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (search) {
      // postgrest or= 语法：逗号分隔，搜索词内的逗号/百分号需转义
      const escaped = search.replace(/[,()%]/g, "\\$&");
      const like = `*${escaped}*`;
      query = query.or(`student_id.ilike.${like},real_name.ilike.${like},nickname.ilike.${like},email.ilike.${like}`);
    }
    const { data, count } = await query;
    return { rows: ((data ?? []) as ProfileRestRow[]).map(mapProfileRow), total: count ?? 0 };
  },

  // 全量角色持有（service_role；供当前页用户行合并）
  fetchAllUserRoles: async () => {
    const { data } = await serverPrivilegedClient().from("user_roles").select("user_id,role");
    return (data ?? []) as AdminRoleRow[];
  },

  // 认证服务封禁状态（账号禁用真源）：banned_until 晚于当前时刻 = 已禁用。
  // listUsers 默认每页 75 条且不自动翻页，单页会漏掉大用户量下的后续页 →
  // 以 perPage 上限 1000 循环翻页拉全量，直到某页返回不足一页（无更多数据）。
  fetchBannedUserIds: async () => {
    const PER_PAGE = 1000;
    const banned = new Set<string>();
    let page = 1;
    for (;;) {
      const { data } = await serverPrivilegedClient().auth.admin.listUsers({ page, perPage: PER_PAGE });
      const users = data?.users ?? [];
      for (const user of users) {
        const until = user.banned_until ? Date.parse(user.banned_until) : NaN;
        if (!Number.isNaN(until) && until > Date.now()) banned.add(user.id);
      }
      if (users.length < PER_PAGE) break;
      page += 1;
    }
    return banned;
  },

  // 角色合法集（roles 表 name 主键；service_role 读）
  fetchValidRoleNames: async () => {
    const { data } = await serverPrivilegedClient().from("roles").select("name");
    return ((data ?? []) as { name: string }[]).map((row) => row.name);
  },

  // 按角色集合查各角色权限点列表（service_role 读，供自我保护判定并集是否含「访问后台」）
  fetchRolePermissions: async (roles) => {
    if (roles.length === 0) return [];
    const { data } = await serverPrivilegedClient().from("role_permissions").select("role,permission").in("role", roles);
    // 每个角色一行一组（同角色多权限点合并进同一组），无权限点角色给空组占位以便并集判定
    const byRole = new Map<string, string[]>(roles.map((role) => [role, []]));
    for (const row of (data ?? []) as { role: string; permission: string }[]) {
      byRole.get(row.role)?.push(row.permission);
    }
    return [...byRole.values()];
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

  // 认证管理 API 封禁写入（账号禁用真源，service_role）：true = 永久封禁（会话立即失效且阻止登录），false = 清除封禁恢复登录
  setUserBanned: async (userId, banned) => {
    const { error } = await serverPrivilegedClient().auth.admin.updateUserById(userId, {
      // 永久封禁：ban_duration 足够长（约 100 年）即事实永久；解封传 "none" 清除 banned_until
      ban_duration: banned ? "876000h" : "none",
    });
    if (error) throw new Error(error.message);
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

  // 域包放出清单读取（#55，service_role 读，pack_id 稳定排序展示）
  fetchExposedPackIds: async () => {
    const { data } = await serverPrivilegedClient().from("pack_exposure").select("pack_id").order("pack_id");
    return ((data ?? []) as { pack_id: string }[]).map((row) => row.pack_id);
  },

  // 域包放出清单全量替换（幂等）：先清空再写入（照域名清单模式；PostgREST 无事务，失败抛错由编排层兜底 500）
  replaceExposedPackIds: async (packIds) => {
    const client = serverPrivilegedClient();
    const { error: deleteError } = await client.from("pack_exposure").delete().neq("pack_id", "");
    if (deleteError) throw new Error(deleteError.message);
    if (packIds.length === 0) return;
    const { error: insertError } = await client.from("pack_exposure").insert(packIds.map((packId) => ({ pack_id: packId })));
    if (insertError) throw new Error(insertError.message);
  },

  // 知识点词表全量读取（#79，service_role）：名称稳定排序展示；含停用条目（管理视图即全量）
  fetchKnowledgeAreas: async () => {
    const { data, error } = await serverPrivilegedClient()
      .from("knowledge_area")
      .select("id,name,description,active")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminKnowledgeAreaEntry[];
  },

  // 词表条目创建：唯一约束（name）违例映射为 duplicate（业务态），其余异常上抛由编排层兜底 500
  insertKnowledgeArea: async (entry) => {
    const { data, error } = await serverPrivilegedClient()
      .from("knowledge_area")
      .insert({ name: entry.name, description: entry.description })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { status: "duplicate" };
      throw new Error(error.message);
    }
    return { status: "ok", id: (data as { id: string }).id };
  },

  // 词表条目编辑：带回读行判定 not_found（0 行受影响 = 条目不存在）；唯一违例映射 duplicate
  updateKnowledgeArea: async (id, entry) => {
    const { data, error } = await serverPrivilegedClient()
      .from("knowledge_area")
      .update({ name: entry.name, description: entry.description })
      .eq("id", id)
      .select("id");
    if (error) {
      if (error.code === "23505") return "duplicate";
      throw new Error(error.message);
    }
    return (data ?? []).length === 0 ? "not_found" : "updated";
  },

  // 词表条目删除（本票即物理删除；被引用禁删在 #83 引用形态落地后引入）
  deleteKnowledgeArea: async (id) => {
    const { data, error } = await serverPrivilegedClient()
      .from("knowledge_area")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length === 0 ? "not_found" : "deleted";
  },

  // 词表条目启停：停用条目仍可被既有包引用、只是不能再被新圈选（ADR 0010）
  setKnowledgeAreaActive: async (id, active) => {
    const { data, error } = await serverPrivilegedClient()
      .from("knowledge_area")
      .update({ active })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length === 0 ? "not_found" : "updated";
  },
};

/** 共享状态 → HTTP 响应映射（全部 /api/admin/* route 复用）：401 / 403 / 500 及固定中文文案只此一处；
 *  业务专属状态（invalid_* / self_protection 等）文案与状态码由各 route 自行映射。 */
export function adminErrorResponse(status: "unauthorized" | "forbidden" | "error"): Response {
  switch (status) {
    case "unauthorized":
      return Response.json({ error: "未登录或登录态已失效" }, { status: 401 });
    case "forbidden":
      return Response.json({ error: "没有访问后台的权限" }, { status: 403 });
    default:
      return Response.json({ error: "管理服务暂不可用，请稍后重试" }, { status: 500 });
  }
}

/** 鉴权链（共享收口，全部管理 API 复用）：Bearer → 验明身份 → 权限并集 → 持「访问后台」放行；
 *  additionalPermission 供在后台入口之上还需专属权限点的路由复用（如域包放出管理需「域包管理」） */
export async function authorizeAdminRequest(
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
  additionalPermission?: string,
): Promise<AdminAuthResult> {
  const token = extractBearerToken(authorization);
  if (!token) return { status: "unauthorized" };
  const identity = await deps.verifyAccessToken(token);
  if (!identity) return { status: "unauthorized" };
  try {
    const permissions = await deps.fetchUserPermissions(identity.userId);
    // 判定只认权限点（ADR-0005）：入口点 + 附加点（如有）须同时持有
    if (!hasPermission(permissions, PERMISSIONS.adminConsole)) return { status: "forbidden" };
    if (additionalPermission !== undefined && !hasPermission(permissions, additionalPermission)) {
      return { status: "forbidden" };
    }
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
 *  自我保护（ADR-0007 / ADR-0005）：操作者==目标用户且新角色集合的权限点并集不含「访问后台」→ 服务端强制拒绝，不落库。
 *  判定只认权限点不认角色名：将来其他角色挂「访问后台」时不会被误拒。 */
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

  // 自我保护：新角色集合的权限点并集不含「访问后台」= 会移除自己的后台访问，拒绝（ADR-0005 只认权限点）
  if (auth.userId === targetUserId) {
    const rolePermissions = await deps.fetchRolePermissions(requested);
    if (!hasPermission(mergePermissions(rolePermissions), PERMISSIONS.adminConsole)) {
      return { status: "self_protection" };
    }
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

/** 账号禁用/启用编排（T4，spec #41）：鉴权前置 → 载荷校验 → 自我保护 → 认证管理 API 封禁/解封。
 *  禁用真源在云端认证服务（GLOSSARY「账号禁用」）：封禁立即失效目标用户会话并阻止登录；解封恢复登录。
 *  自我保护（ADR-0007）：操作者==目标且 banned=true → 服务端强制拒绝，封禁不生效（对自己解封不属自我锁定，放行）。 */
export async function setAdminUserBan(
  targetUserId: string,
  banned: unknown,
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminSetBanResult> {
  const auth = await authorizeAdminRequest(authorization, deps);
  if (auth.status !== "ok") return auth;

  // 载荷校验：banned 必须是布尔
  if (typeof banned !== "boolean") return { status: "invalid_banned" };

  // 自我保护：不能禁用自己（体验层按钮禁用之外的服务端强制）
  if (auth.userId === targetUserId && banned) return { status: "self_protection" };

  try {
    await deps.setUserBanned(targetUserId, banned);
    return { status: "ok", banned };
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

/** 域包放出清单读取（#55，spec #53 目标③）：鉴权前置（访问后台 + 域包管理）→ 回读清单全量 */
export async function getAdminPackExposure(
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminPackExposureResult> {
  const auth = await authorizeAdminRequest(authorization, deps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return auth;
  try {
    const packIds = await deps.fetchExposedPackIds();
    return { status: "ok", packIds };
  } catch {
    return { status: "error" };
  }
}

/** 域包放出清单全量保存（幂等）：鉴权前置 → 载荷归一（trim、去重，保持首见顺序）→ 全量替换；
 *  空清单合法：清空全部行 = 回到「未配置」状态，学生端默认全部放出（教师端界面在该情形明示语义）；
 *  归一后逐项须为非空字符串，否则 invalid。 */
export async function saveAdminPackExposure(
  rawPackIds: unknown,
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminSavePackExposureResult> {
  const auth = await authorizeAdminRequest(authorization, deps, PERMISSIONS.packExposure);
  if (auth.status !== "ok") return auth;

  if (!Array.isArray(rawPackIds)) return { status: "invalid" };
  const normalized = new Set<string>();
  for (const item of rawPackIds) {
    if (typeof item !== "string") return { status: "invalid" };
    const packId = item.trim();
    if (packId === "") return { status: "invalid" };
    normalized.add(packId);
  }
  try {
    await deps.replaceExposedPackIds([...normalized]);
    return { status: "ok" };
  } catch {
    return { status: "error" };
  }
}

// ══════════════ 知识点词表管理（#79 / spec #75，ADR 0010） ══════════════
// 全部走「访问后台 + 知识点词表管理」双权限点（authorizeAdminRequest 附加权限先例：域包放出管理）；
// 写入经 service_role 落库（RLS 无写策略兜底）；删除本票即物理删除——被引用禁删与被引用视图
// 属后续票 #83（引用形态尚不存在），不做不预留。

/** 名称归一：去首尾空白；空串非法返回 null */
function normalizeKnowledgeAreaName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name === "" ? null : name;
}

/** 描述归一：非字符串或纯空白归空串（描述可选） */
function normalizeKnowledgeAreaDescription(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** 词表全量列表：鉴权前置（双权限点）→ 全量回读（含停用条目） */
export async function listKnowledgeAreas(
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminKnowledgeAreaListResult> {
  const auth = await authorizeAdminRequest(authorization, deps, PERMISSIONS.knowledgeAreaVocab);
  if (auth.status !== "ok") return auth;
  try {
    return { status: "ok", entries: await deps.fetchKnowledgeAreas() };
  } catch {
    return { status: "error" };
  }
}

/** 词表条目创建：鉴权前置 → 名称/描述归一（名称必填非空）→ 落库；重名冲突单独成态 */
export async function createKnowledgeArea(
  rawName: unknown,
  rawDescription: unknown,
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminKnowledgeAreaCreateResult> {
  const auth = await authorizeAdminRequest(authorization, deps, PERMISSIONS.knowledgeAreaVocab);
  if (auth.status !== "ok") return auth;
  const name = normalizeKnowledgeAreaName(rawName);
  if (name === null) return { status: "invalid" };
  const description = normalizeKnowledgeAreaDescription(rawDescription);
  try {
    const outcome = await deps.insertKnowledgeArea({ name, description });
    if (outcome.status === "duplicate") return { status: "duplicate_name" };
    return { status: "ok", id: outcome.id };
  } catch {
    return { status: "error" };
  }
}

/** 词表条目编辑（名称 + 描述）：鉴权前置 → 归一 → 落库；不存在 / 重名冲突单独成态 */
export async function updateKnowledgeArea(
  id: string,
  payload: { name: unknown; description: unknown },
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminKnowledgeAreaUpdateResult> {
  const auth = await authorizeAdminRequest(authorization, deps, PERMISSIONS.knowledgeAreaVocab);
  if (auth.status !== "ok") return auth;
  const name = normalizeKnowledgeAreaName(payload.name);
  if (name === null) return { status: "invalid" };
  const description = normalizeKnowledgeAreaDescription(payload.description);
  try {
    const outcome = await deps.updateKnowledgeArea(id, { name, description });
    if (outcome === "not_found") return { status: "not_found" };
    if (outcome === "duplicate") return { status: "duplicate_name" };
    return { status: "ok" };
  } catch {
    return { status: "error" };
  }
}

/** 词表条目删除（物理删除）：鉴权前置 → 落库；不存在单独成态 */
export async function deleteKnowledgeArea(
  id: string,
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminKnowledgeAreaDeleteResult> {
  const auth = await authorizeAdminRequest(authorization, deps, PERMISSIONS.knowledgeAreaVocab);
  if (auth.status !== "ok") return auth;
  try {
    const outcome = await deps.deleteKnowledgeArea(id);
    if (outcome === "not_found") return { status: "not_found" };
    return { status: "ok" };
  } catch {
    return { status: "error" };
  }
}

/** 词表条目启停：鉴权前置 → 载荷校验（active 布尔）→ 落库；停用条目仍可被既有包引用（ADR 0010） */
export async function setKnowledgeAreaActive(
  id: string,
  active: unknown,
  authorization: string | null,
  deps: AdminDeps = defaultAdminDeps,
): Promise<AdminKnowledgeAreaActiveResult> {
  const auth = await authorizeAdminRequest(authorization, deps, PERMISSIONS.knowledgeAreaVocab);
  if (auth.status !== "ok") return auth;
  if (typeof active !== "boolean") return { status: "invalid" };
  try {
    const outcome = await deps.setKnowledgeAreaActive(id, active);
    if (outcome === "not_found") return { status: "not_found" };
    return { status: "ok", active };
  } catch {
    return { status: "error" };
  }
}
