"use client";

// 邮箱白名单管理（T5，spec #41）：接入 GET/PUT/PATCH /api/admin/whitelist* 的真实数据。
// 请求带浏览器会话的 Bearer token（ADR-0007：安全边界在服务端，本组件只做展示与交互）。
// 交互：总开关切换（PATCH 即时生效）；域名清单增删改 + 全量保存（PUT 幂等）；保存后重拉最新配置。
// 观感与演练场同一设计语言：卡片容器、语义 class、宋体标题、域名走 JetBrains Mono。
import { useCallback, useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser-client";

/** 页面自持的清单条目（编辑中允许空行，保存前交服务层校验） */
interface DraftDomain {
  domain: string;
  note: string;
}

interface WhitelistData {
  allowAnyDomain: boolean;
  domains: { domain: string; note: string | null }[];
}

/** 取浏览器会话 token；无会话返回 null（由调用方提示重新登录） */
async function getSessionToken(): Promise<string | null> {
  const { data } = await browserClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/** 统一错误文案提取：优先回传 error 字段，兜底通用文案 */
async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export default function AdminWhitelistManager() {
  const [allowAnyDomain, setAllowAnyDomain] = useState(false);
  const [drafts, setDrafts] = useState<DraftDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [saving, setSaving] = useState(false);

  /** 拉取当前配置并同步到本地草稿（保存/切换成功后复用，保证展示的是最新配置） */
  const refresh = useCallback(async () => {
    try {
      const token = await getSessionToken();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/whitelist", { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) {
        setError(await readError(response, "白名单配置加载失败"));
        return;
      }
      const data = (await response.json()) as WhitelistData;
      setAllowAnyDomain(data.allowAnyDomain);
      setDrafts(data.domains.map((entry) => ({ domain: entry.domain, note: entry.note ?? "" })));
      setError(null);
    } catch {
      setError("白名单配置加载失败，请稍后重试");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  function updateDraft(index: number, patch: Partial<DraftDomain>) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  }

  /** 总开关切换：PATCH 即时生效，成功后重拉确认服务端现状 */
  async function toggleAllowAny() {
    setSwitching(true);
    setNotice(null);
    try {
      const token = await getSessionToken();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/whitelist/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ allowAnyDomain: !allowAnyDomain }),
      });
      if (!response.ok) {
        setError(await readError(response, "总开关切换失败"));
        return;
      }
      await refresh();
      setNotice(!allowAnyDomain ? "已放开任意域名注册" : "已收紧为仅白名单域名可注册");
    } catch {
      setError("总开关切换失败，请稍后重试");
    } finally {
      setSwitching(false);
    }
  }

  /** 域名清单全量保存：PUT 幂等，成功后重拉最新配置 */
  async function saveDomains(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const token = await getSessionToken();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/whitelist/domains", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          domains: drafts.map((draft) => ({
            domain: draft.domain,
            ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
          })),
        }),
      });
      if (!response.ok) {
        setError(await readError(response, "域名清单保存失败"));
        return;
      }
      await refresh();
      setNotice("域名清单已保存");
    } catch {
      setError("域名清单保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="卡片 p-4" data-testid="白名单管理">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 className="标题 text-base">邮箱白名单</h2>
        <p className="text-xs text-muted">保存后注册校验即时生效，修改前可在此确认当前配置。</p>
      </div>

      {notice ? (
        <p className="mb-3 rounded-md bg-panel px-3 py-2 text-xs text-ink" data-testid="白名单提示">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 text-sm text-muted" data-testid="白名单错误">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="呼吸 py-8 text-center text-sm text-muted">正在加载白名单配置…</p>
      ) : (
        <>
          {/* 总开关：卡片内独立分区，当前状态一眼可辨 */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md bg-panel px-3 py-2.5" data-testid="白名单总开关">
            <div>
              <p className="text-sm">放开任意域名注册</p>
              <p className="mt-0.5 text-xs text-muted">
                {allowAnyDomain ? "当前：任何邮箱域名都可注册" : "当前：仅下方清单内域名可注册"}
              </p>
            </div>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted">{allowAnyDomain ? "已放开" : "已收紧"}</span>
              <button
                type="button"
                className="次按钮 px-3 py-1.5 text-xs"
                disabled={switching}
                onClick={toggleAllowAny}
              >
                {allowAnyDomain ? "收紧" : "放开"}
              </button>
            </span>
          </div>

          <form onSubmit={saveDomains}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs text-muted">可注册域名清单（含备注）</p>
              <button
                type="button"
                className="次按钮 px-3 py-1.5 text-xs"
                data-testid="新增域名"
                onClick={() => setDrafts((current) => [...current, { domain: "", note: "" }])}
              >
                新增域名
              </button>
            </div>

            {drafts.length ? (
              <ul className="flex flex-col gap-2" data-testid="域名清单">
                {drafts.map((draft, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2" data-testid="域名行">
                    <input
                      className="输入框 min-w-0 flex-1 basis-48 font-mono text-xs"
                      data-testid="域名输入框"
                      type="text"
                      value={draft.domain}
                      placeholder="如 cuc.edu.cn"
                      aria-label="域名"
                      onChange={(event) => updateDraft(index, { domain: event.target.value })}
                    />
                    <input
                      className="输入框 min-w-0 flex-1 basis-40 text-xs"
                      data-testid="域名备注输入框"
                      type="text"
                      value={draft.note}
                      placeholder="备注（可选），如 校内主域"
                      aria-label="备注"
                      onChange={(event) => updateDraft(index, { note: event.target.value })}
                    />
                    <button
                      type="button"
                      className="次按钮 shrink-0 px-3 py-1.5 text-xs"
                      data-testid="删除域名"
                      onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-xs text-muted" data-testid="域名清单空态">
                清单为空：总开关收紧时任何域名都无法注册
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span className="font-mono" data-testid="域名清单统计">
                共 {drafts.length} 个域名
              </span>
              <button type="submit" className="主按钮 px-4 py-1.5 text-xs" disabled={saving} data-testid="保存域名清单">
                {saving ? "正在保存…" : "保存域名清单"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
