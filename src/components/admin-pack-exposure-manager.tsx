"use client";

// 域包放出管理区块（issue #55 / spec #53 目标③，GLOSSARY「域包放出」）：
// 接入 GET/PUT /api/admin/pack-exposure 的真实数据；请求带浏览器会话的 Bearer token（ADR-0007：
// 安全边界在服务端——本组件与所在页面均只做展示与交互，无权限者在 API 层被拒）。
// 组件刻意保持独立（props 注入可选域包清单，不直接 import 注册表）：
// 后续票 #60 的域包管理页会把本区块原样收纳，届时仅需换 props 来源。
// 语义：清单为空（未配置）= 默认全部放出；保存空勾选即回到未配置（界面在该情形明示）。
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { bearerHeaders, getSessionAuth, readErrorMessage } from "@/lib/admin-api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** 写操作反馈 toast：固定 id 使新反馈原位替换旧反馈（同一时刻只有一条） */
const FEEDBACK_TOAST = { id: "放出提示", testId: "放出提示" };

/** 错误反馈时长 8 秒（多条拼接的长错误读得完），成功仍走默认 4 秒 */
const FEEDBACK_ERROR_TOAST = { ...FEEDBACK_TOAST, duration: 8000 };

/** 可选域包条目：packId 稳定标识，name 展示用（由调用方注入，便于 #60 搬迁换源） */
export interface PackExposureOption {
  packId: string;
  name: string;
}

/** 放出管理区块 props：packs 为学生端可选的全部域包（现状=内置注册表，#60 起来自域包数据资产） */
export interface AdminPackExposureManagerProps {
  packs: readonly PackExposureOption[];
}

export default function AdminPackExposureManager({ packs }: AdminPackExposureManagerProps) {
  // null = 未配置（云端清单为空，默认全放；勾选草稿从全放出发编辑）；首帧 loading 挡渲染
  const [exposedIds, setExposedIds] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 拉取当前放出清单（保存成功后复用，保证展示的是最新配置） */
  const refresh = useCallback(async () => {
    try {
      const { token } = await getSessionAuth();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/pack-exposure", { headers: bearerHeaders(token) });
      if (!response.ok) {
        setError(await readErrorMessage(response, "放出清单加载失败"));
        return;
      }
      const body = (await response.json()) as { packIds: string[] };
      // 清单为空 = 未配置（默认全放），用 null 表达以区分「有意放出集合」
      setExposedIds(body.packIds.length === 0 ? null : new Set(body.packIds));
      setError(null);
    } catch {
      setError("放出清单加载失败，请稍后重试");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  /** 勾选/取消勾选一个域包（本地草稿，保存前不影响云端） */
  const toggle = (packId: string) => {
    setExposedIds((current) => {
      const base = current ?? new Set(packs.map((p) => p.packId)); // 未配置时从「全放」出发编辑
      const next = new Set(base);
      if (next.has(packId)) next.delete(packId);
      else next.add(packId);
      return next;
    });
  };

  const save = useCallback(async () => {
    if (exposedIds === null) return;
    setSaving(true);
    try {
      const { token } = await getSessionAuth();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/pack-exposure", {
        method: "PUT",
        headers: bearerHeaders(token, { "content-type": "application/json" }),
        body: JSON.stringify({ packIds: [...exposedIds] }),
      });
      if (!response.ok) {
        toast.error(await readErrorMessage(response, "放出清单保存失败"), FEEDBACK_ERROR_TOAST);
        return;
      }
      setError(null);
      toast.success("已保存，学生端可演练列表即时生效", FEEDBACK_TOAST);
      await refresh();
    } catch {
      toast.error("放出清单保存失败，请稍后重试", FEEDBACK_ERROR_TOAST);
    } finally {
      setSaving(false);
    }
  }, [exposedIds, refresh]);

  if (loading) return <p className="text-sm text-muted">正在加载放出清单……</p>;

  const isUnconfigured = exposedIds === null;

  return (
    <Card asChild className="rounded-2xl border-ink/10 p-5">
      <section data-testid="域包放出管理" aria-label="域包放出管理">
        <h2 className="标题 mb-1 text-lg">域包放出</h2>
        <p className="mb-4 text-xs text-muted">
          勾选的域包对学生可见（可演练列表）；清单为空时默认全部放出。放出与否不影响进行中的会话。
        </p>
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-fail/10 px-3 py-2 text-xs text-fail">
            {error}
          </p>
        )}
        <ul className="mb-4 flex flex-col gap-2">
          {packs.map((pack) => {
            const checked = exposedIds === null || exposedIds.has(pack.packId);
            return (
              <li key={pack.packId}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink/[0.03]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(pack.packId)}
                    data-testid={`放出勾选-${pack.name}`}
                    className="h-4 w-4 accent-ink"
                  />
                  <span>{pack.name}</span>
                  <span className="font-mono text-xs text-muted">{pack.packId}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {isUnconfigured && (
          <p className="mb-3 text-xs text-warn">
            未勾选任何域包：保存后清单清空，回到「默认全部放出」。
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving} size="sm" className="px-4">
            {saving ? "保存中……" : "保存放出清单"}
          </Button>
          <span className="text-xs text-muted">当前放出 {exposedIds?.size ?? packs.length} / {packs.length}</span>
        </div>
      </section>
    </Card>
  );
}
