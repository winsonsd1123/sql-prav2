"use client";

// 邮箱白名单管理（T5，spec #41）：接入 GET/PUT/PATCH /api/admin/whitelist* 的真实数据。
// 请求带浏览器会话的 Bearer token（ADR-0007：安全边界在服务端，本组件只做展示与交互）。
// 交互：总开关切换（PATCH 即时生效）；域名清单增删改 + 全量保存（PUT 幂等）；保存后重拉最新配置。
// 观感与演练场同一设计语言：卡片容器、语义 class、宋体标题、域名走 JetBrains Mono。
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { bearerHeaders, getSessionAuth, readErrorMessage } from "@/lib/admin-api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** 写操作反馈 toast：固定 id 使新反馈原位替换旧反馈（同一时刻只有一条） */
const FEEDBACK_TOAST = { id: "白名单提示", testId: "白名单提示" };

/** 错误反馈时长 8 秒（多条拼接的长错误读得完），成功仍走默认 4 秒 */
const FEEDBACK_ERROR_TOAST = { ...FEEDBACK_TOAST, duration: 8000 };

/** 页面自持的清单条目（编辑中允许空行，保存前交服务层校验） */
interface DraftDomain {
  domain: string;
  note: string;
}

interface WhitelistData {
  allowAnyDomain: boolean;
  domains: { domain: string; note: string | null }[];
}

export default function AdminWhitelistManager() {
  const [allowAnyDomain, setAllowAnyDomain] = useState(false);
  const [drafts, setDrafts] = useState<DraftDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [saving, setSaving] = useState(false);

  /** 拉取当前配置并同步到本地草稿（保存/切换成功后复用，保证展示的是最新配置） */
  const refresh = useCallback(async () => {
    try {
      const { token } = await getSessionAuth();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/whitelist", { headers: bearerHeaders(token) });
      if (!response.ok) {
        setError(await readErrorMessage(response, "白名单配置加载失败"));
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
    try {
      const { token } = await getSessionAuth();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/whitelist/config", {
        method: "PATCH",
        headers: bearerHeaders(token, { "content-type": "application/json" }),
        body: JSON.stringify({ allowAnyDomain: !allowAnyDomain }),
      });
      if (!response.ok) {
        toast.error(await readErrorMessage(response, "总开关切换失败"), FEEDBACK_ERROR_TOAST);
        return;
      }
      await refresh();
      toast.success(!allowAnyDomain ? "已放开任意域名注册" : "已收紧为仅白名单域名可注册", FEEDBACK_TOAST);
    } catch {
      toast.error("总开关切换失败，请稍后重试", FEEDBACK_ERROR_TOAST);
    } finally {
      setSwitching(false);
    }
  }

  /** 域名清单全量保存：PUT 幂等，成功后重拉最新配置 */
  async function saveDomains(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const { token } = await getSessionAuth();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/whitelist/domains", {
        method: "PUT",
        headers: bearerHeaders(token, { "content-type": "application/json" }),
        body: JSON.stringify({
          domains: drafts.map((draft) => ({
            domain: draft.domain,
            ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
          })),
        }),
      });
      if (!response.ok) {
        toast.error(await readErrorMessage(response, "域名清单保存失败"), FEEDBACK_ERROR_TOAST);
        return;
      }
      await refresh();
      toast.success("域名清单已保存", FEEDBACK_TOAST);
    } catch {
      toast.error("域名清单保存失败，请稍后重试", FEEDBACK_ERROR_TOAST);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card asChild className="p-4">
      <section data-testid="白名单管理">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <h2 className="标题 text-base">邮箱白名单</h2>
          <p className="text-xs text-muted">保存后注册校验即时生效，修改前可在此确认当前配置。</p>
        </div>

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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="px-3"
                  disabled={switching}
                  onClick={toggleAllowAny}
                >
                  {allowAnyDomain ? "收紧" : "放开"}
                </Button>
              </span>
            </div>

            <form onSubmit={saveDomains}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">可注册域名清单（含备注）</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="px-3"
                  data-testid="新增域名"
                  onClick={() => setDrafts((current) => [...current, { domain: "", note: "" }])}
                >
                  新增域名
                </Button>
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="px-3"
                        data-testid="删除域名"
                        onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
                      >
                        删除
                      </Button>
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
                <Button type="submit" size="sm" className="px-4" disabled={saving} data-testid="保存域名清单">
                  {saving ? "正在保存…" : "保存域名清单"}
                </Button>
              </div>
            </form>
          </>
        )}
      </section>
    </Card>
  );
}
