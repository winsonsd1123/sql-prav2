"use client";

// 用户管理列表（T2，spec #41）：接入 GET /api/admin/users 的真实数据。
// 请求带浏览器会话的 Bearer token（ADR-0007：安全边界在服务端，本组件只做展示与交互）。
// 观感与演练场同一设计语言：卡片容器、语义 class、宋体标题、JetBrains Mono 数字列。
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser-client";
import { ADMIN_ROLE_CANDIDATES, ADMIN_ROLE_NAME, type AdminUserRow } from "@/lib/admin-users";

interface UsersPageData {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** 注册时间 → 本地展示格式（2026-10-02 10:00）；解析失败原样返回 */
function formatCreatedAt(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function AdminUsersList() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersPageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 当前会话用户 id：标记「自己那一行」，禁用其「管理员」复选（体验层；服务端才是强制）
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // 行内角色编辑（T3）：editingUserId 为空 = 无行处于编辑态
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingRoles, setEditingRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  // 数据加载（照 current-permissions 的 effect 内 async IIFE 模式）：
  // 搜索词或页码变化即重拉；状态更新全部在 await 之后，effect 内无同步 setState。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await browserClient().auth.getSession();
        const token = sessionData.session?.access_token;
        if (cancelled) return;
        setCurrentUserId(sessionData.session?.user?.id ?? null);
        setLoading(true);
        setError(null);
        if (!token) {
          setError("登录态已失效，请重新登录");
          return;
        }
        const params = new URLSearchParams({ q: search, page: String(page) });
        const response = await fetch(`/api/admin/users?${params}`, { headers: { authorization: `Bearer ${token}` } });
        if (cancelled) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "用户列表加载失败");
          return;
        }
        setData((await response.json()) as UsersPageData);
      } catch {
        if (!cancelled) setError("用户列表加载失败，请稍后重试");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setSearch(input.trim());
    setPage(1);
  }

  // ── 行内角色编辑（T3，spec #41）：进入编辑 / 勾选切换 / 全量保存 ──

  function beginEditRoles(user: AdminUserRow) {
    setEditingUserId(user.userId);
    setEditingRoles(user.roles);
    setRoleError(null);
  }

  function toggleEditingRole(role: string) {
    setEditingRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  }

  /** 全量保存：PUT /api/admin/users/:id/roles（Bearer token）；成功后行内徽章即时更新 */
  async function saveRoles(user: AdminUserRow) {
    try {
      setSaving(true);
      setRoleError(null);
      const { data: sessionData } = await browserClient().auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setRoleError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.userId)}/roles`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ roles: editingRoles }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setRoleError(body?.error ?? "角色保存失败，请稍后重试");
        return;
      }
      const body = (await response.json()) as { roles: string[] };
      setData((current) =>
        current ? { ...current, users: current.users.map((row) => (row.userId === user.userId ? { ...row, roles: body.roles } : row)) } : current,
      );
      setEditingUserId(null);
    } catch {
      setRoleError("角色保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="卡片 p-4" data-testid="用户列表">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 className="标题 text-base">用户管理</h2>
        <form className="flex w-full max-w-sm gap-2" onSubmit={submitSearch}>
          <input
            className="输入框"
            data-testid="用户搜索框"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="搜索学号 / 姓名 / 昵称 / 邮箱"
            aria-label="搜索用户"
          />
          <button type="submit" className="次按钮 shrink-0 px-3 py-1.5 text-xs">
            搜索
          </button>
        </form>
      </div>

      {error ? (
        <p className="py-8 text-center text-sm text-muted" data-testid="用户列表错误">
          {error}
        </p>
      ) : !data && !error ? (
        <p className="呼吸 py-8 text-center text-sm text-muted">正在加载用户列表…</p>
      ) : (
        <>
          <div className="横滑 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[color-mix(in_srgb,var(--色-墨)_12%,transparent)] text-left text-xs text-muted">
                  <th className="px-2 py-2 font-medium">学号</th>
                  <th className="px-2 py-2 font-medium">姓名</th>
                  <th className="px-2 py-2 font-medium">昵称</th>
                  <th className="px-2 py-2 font-medium">邮箱</th>
                  <th className="px-2 py-2 font-medium">角色</th>
                  <th className="px-2 py-2 font-medium">账号状态</th>
                  <th className="px-2 py-2 font-medium">注册时间</th>
                </tr>
              </thead>
              <tbody>
                {data?.users.length ? (
                  data.users.map((user) => (
                    <tr
                      key={user.userId}
                      data-testid="用户行"
                      className="border-b border-[color-mix(in_srgb,var(--色-墨)_6%,transparent)] last:border-b-0 hover:bg-panel"
                    >
                      <td className="px-2 py-2 font-mono text-xs">{user.studentId ?? "—"}</td>
                      <td className="px-2 py-2">{user.realName ?? "—"}</td>
                      <td className="px-2 py-2 text-muted">{user.nickname ?? "—"}</td>
                      <td className="px-2 py-2 text-xs text-muted">{user.email ?? "—"}</td>
                      <td className="px-2 py-2">
                        {editingUserId === user.userId ? (
                          <span className="flex flex-col gap-1.5" data-testid="角色编辑器">
                            <span className="flex flex-wrap gap-1">
                              {ADMIN_ROLE_CANDIDATES.map((role) => {
                                const isSelfAdminLock = user.userId === currentUserId && role === ADMIN_ROLE_NAME;
                                return (
                                  <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={editingRoles.includes(role)}
                                    key={role}
                                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                                      editingRoles.includes(role) ? "bg-[color-mix(in_srgb,var(--色-墨)_10%,transparent)] text-ink" : "bg-panel text-muted"
                                    } ${isSelfAdminLock ? "cursor-not-allowed opacity-60" : ""}`}
                                    title={isSelfAdminLock ? "不能回收自己的管理员角色" : undefined}
                                    data-testid={`角色复选-${role}`}
                                    disabled={isSelfAdminLock}
                                    onClick={() => toggleEditingRole(role)}
                                  >
                                    {role}
                                  </button>
                                );
                              })}
                            </span>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                className="次按钮 px-2.5 py-1 text-[11px]"
                                data-testid="角色保存"
                                disabled={saving}
                                onClick={() => void saveRoles(user)}
                              >
                                {saving ? "保存中…" : "保存"}
                              </button>
                              <button
                                type="button"
                                className="次按钮 px-2.5 py-1 text-[11px]"
                                data-testid="角色取消"
                                disabled={saving}
                                onClick={() => setEditingUserId(null)}
                              >
                                取消
                              </button>
                              {user.userId === currentUserId && (
                                <span className="text-[11px] text-muted">「管理员」不可自行回收</span>
                              )}
                            </span>
                          </span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="flex flex-wrap gap-1" data-testid="用户角色">
                              {user.roles.length ? (
                                user.roles.map((role) => (
                                  <span
                                    key={role}
                                    className="whitespace-nowrap rounded-full bg-panel px-2 py-0.5 text-[11px] text-ink"
                                  >
                                    {role}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[11px] text-muted">未分配</span>
                              )}
                            </span>
                            <button
                              type="button"
                              className="次按钮 px-2 py-0.5 text-[11px]"
                              data-testid="角色编辑"
                              onClick={() => beginEditRoles(user)}
                            >
                              编辑
                            </button>
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {user.banned ? (
                          <span className="rounded-full px-2 py-0.5 text-[11px] text-[var(--色-错误)]">已禁用</span>
                        ) : (
                          <span className="text-muted">正常</span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-muted">{formatCreatedAt(user.createdAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-muted" data-testid="用户列表空态">
                      {search ? `没有匹配「${search}」的用户` : "暂无用户"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {roleError && (
            <p className="mt-2 text-center text-xs text-[var(--色-错误)]" data-testid="角色保存错误" role="alert">
              {roleError}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span data-testid="用户列表统计" className="font-mono">
              {data ? `共 ${data.total} 人 · 第 ${data.page}/${totalPages} 页` : ""}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className="次按钮 px-3 py-1.5 text-xs"
                data-testid="用户列表上一页"
                disabled={loading || page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="次按钮 px-3 py-1.5 text-xs"
                data-testid="用户列表下一页"
                disabled={loading || page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                下一页
              </button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
