"use client";

// 域包版本历史区块（票 #62 / ADR-0009）：每个域包（按基础名）可查历史版本列表——
// 当前版本置顶（标「当前」），其后为 B 类微调产生的历史代次（packId 带版本后缀）。
// 选择包后才发查询（GET /api/admin/domain-packs/versions?packId=基础名）；
// 读取失败给明确错误与重试，不静默降级（管理页只读区块，重进即恢复）。
// 鉴权在 API 层（ADR-0007）；经 admin-api-client 带 Bearer token。

import { useEffect, useState } from "react";
import Link from "next/link";
import { bearerHeaders, getSessionAuth } from "@/lib/admin-api-client";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";
import type { DomainPack } from "@/kernel/types";

/** 版本历史条目（与 /api/admin/domain-packs/versions 响应同形） */
interface VersionEntry {
  packId: string;
  versionLabel: string;
  name: string;
  createdAt: string | null;
  isCurrent: boolean;
}

export interface AdminDomainPackVersionHistoryProps {
  /** 展示清单（页面收敛：每基础名一行最新版）；选择器选项基础名派生 */
  packs: readonly DomainPack[];
  /** 预选基础名（票 #68 跨页 ?packId= 契约）：作为选择器初始值立即自动查询；缺省回退占位项由页内选择 */
  initialBasePackId?: string;
}

export default function AdminDomainPackVersionHistory({ packs, initialBasePackId }: AdminDomainPackVersionHistoryProps) {
  const options = packs.map((d) => {
    const { base } = parsePackIdVersion(d.packId);
    return { base, name: d.name };
  });
  const [selectedBase, setSelectedBase] = useState(initialBasePackId ?? "");
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedBase === "") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { token } = await getSessionAuth();
        if (!token) {
          if (!cancelled) setError("登录态已失效，请重新登录");
          return;
        }
        const response = await fetch(`/api/admin/domain-packs/versions?packId=${encodeURIComponent(selectedBase)}`, {
          headers: bearerHeaders(token),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) setError(body?.error ?? "版本历史读取失败，请重试");
          return;
        }
        const body = (await response.json()) as { versions: VersionEntry[] };
        if (!cancelled) setVersions(body.versions);
      } catch {
        if (!cancelled) setError("版本历史读取失败，请重试");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBase]);

  return (
    <section
      data-testid="版本历史"
      aria-label="域包版本历史"
      className="卡片 rounded-2xl border border-ink/10 bg-paper p-5"
    >
      <h2 className="标题 mb-1 text-lg">域包版本历史</h2>
      <p className="mb-4 text-xs text-muted">
        B 类微调产生的历代版本（进行中会话仍加载其进入时的版本；新会话使用当前版本）。
      </p>
      <div className="flex flex-col gap-3">
        <select
          data-testid="版本历史目标域包"
          className="w-fit rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
          value={selectedBase}
          onChange={(e) => {
            // 切换目标即清空上一包的历史（查询失败提示一并清除），effect 只负责拉取
            setSelectedBase(e.target.value);
            setVersions(null);
            setError(null);
          }}
        >
          <option value="">请选择域包</option>
          {options.map((o) => (
            <option key={o.base} value={o.base}>
              {o.name}（{o.base}）
            </option>
          ))}
        </select>
        {loading && <p className="text-sm text-muted">正在读取版本历史……</p>}
        {error !== null && <p className="text-xs text-fail" data-testid="版本历史错误">{error}</p>}
        {versions !== null && !loading && error === null && (
          versions.length === 0 ? (
            <p className="text-sm text-muted">该域包尚无版本记录。</p>
          ) : (
            <table className="w-full text-left text-sm" data-testid="版本历史列表">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-1 pr-3 font-normal">版本</th>
                  <th className="py-1 pr-3 font-normal">packId</th>
                  <th className="py-1 pr-3 font-normal">名称</th>
                  <th className="py-1 pr-3 font-normal">状态</th>
                  <th className="py-1 font-normal">内容</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.versionLabel} className="border-t border-ink/5">
                    <td className="py-1.5 pr-3 font-mono text-xs">{v.versionLabel}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-muted">{v.packId}</td>
                    <td className="py-1.5 pr-3">{v.name}</td>
                    <td className="py-1.5 text-xs">
                      {v.isCurrent ? (
                        <span className="text-pass">当前（新会话使用）</span>
                      ) : (
                        <span className="text-muted">历史（旧会话钉住）</span>
                      )}
                    </td>
                    {/* 查看该版本完整内容（票 #86）：携带完整版本 packId 跳版本内容视图页，
                        复用详情页展示组件双数据源渲染（当前资产 / 历史资产） */}
                    <td className="py-1.5">
                      <Link
                        href={`/admin/packs/versions/view?packId=${encodeURIComponent(v.packId)}`}
                        className="text-xs text-accent underline-offset-2 hover:underline"
                        data-testid={`查看内容-${v.packId}`}
                      >
                        查看内容
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </section>
  );
}
