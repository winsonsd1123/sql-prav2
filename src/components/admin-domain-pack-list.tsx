"use client";

// 域包列表区块（票 #60 / spec #53 目标②）：内置 + 云端（含 LLM 发布）合并展示
// 名称/packId/表数/模板数/难度五档概览/来源/放出状态。
// 数据来源：props 注入内置与云端两组注册表（页面取 builtinDomainPacks + cloudPackStore，
// 复用 #57 加载层，不加只读 API——管理页与学生端同一数据源，见施工记录的取舍说明）；
// 放出状态自查 GET /api/admin/pack-exposure（与放出管理区块同源同语义：空清单 = 默认全放）。
// 行视图口径在 domain-pack-admin-view-model 纯函数（单测锁死），本组件只渲染。

import { useEffect, useState } from "react";
import { bearerHeaders, getSessionAuth } from "@/lib/admin-api-client";
import { buildDomainPackListRows, type DomainPackListRow } from "@/components/domain-pack-admin-view-model";
import type { DomainPack } from "@/kernel/types";

export interface AdminDomainPackListProps {
  /** 内置域包（随前端发布，来源列恒「内置」） */
  builtin: readonly DomainPack[];
  /** 云端域包（domain_pack_asset，含 LLM 生成后发布的；与内置同 id 的行不占列表位） */
  cloud: readonly DomainPack[];
  /** 云端就绪标记（false = 仍在拉取，列表只含内置，副注说明） */
  cloudLoaded: boolean;
}

export default function AdminDomainPackList({ builtin, cloud, cloudLoaded }: AdminDomainPackListProps) {
  // null = 放出清单未配置（默认全部放出）；undefined = 尚未加载完成（列表暂不渲染）
  const [exposedIds, setExposedIds] = useState<ReadonlySet<string> | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const { token } = await getSessionAuth();
        if (!token) {
          // 静默降级意图：登录态失效 → 放出状态按空清单展示（全部「未放出」），不阻断列表本身
          setExposedIds(new Set());
          return;
        }
        const response = await fetch("/api/admin/pack-exposure", { headers: bearerHeaders(token) });
        if (!response.ok) {
          // 静默降级意图：放出清单拉取失败 → 同空清单展示（列表本身不依赖它），保存操作仍在放出管理区块给明确报错
          setExposedIds(new Set());
          return;
        }
        const body = (await response.json()) as { packIds: string[] };
        setExposedIds(body.packIds.length === 0 ? null : new Set(body.packIds));
      } catch {
        setExposedIds(new Set());
      }
    })();
  }, []);

  const rows: DomainPackListRow[] =
    exposedIds === undefined ? [] : buildDomainPackListRows(builtin, cloud, exposedIds);

  return (
    <section
      data-testid="域包列表"
      aria-label="域包列表"
      className="卡片 rounded-2xl border border-ink/10 bg-paper p-5"
    >
      <h2 className="标题 mb-1 text-lg">域包列表</h2>
      <p className="mb-4 text-xs text-muted">
        全部可演练域包（内置随前端发布；云端含 AI 生成后发布的）。
        {!cloudLoaded && " 云端域包仍在加载……"}
      </p>
      {exposedIds === undefined || rows.length === 0 ? (
        <p className="text-sm text-muted">正在加载域包清单……</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1 pr-3 font-normal">名称</th>
              <th className="py-1 pr-3 font-normal">packId</th>
              <th className="py-1 pr-3 font-normal">表数</th>
              <th className="py-1 pr-3 font-normal">模板数</th>
              <th className="py-1 pr-3 font-normal">难度五档概览</th>
              <th className="py-1 pr-3 font-normal">来源</th>
              <th className="py-1 font-normal">放出状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.packId} className="border-t border-ink/5" data-testid={`域包行-${row.name}`}>
                <td className="py-1.5 pr-3">{row.name}</td>
                <td className="py-1.5 pr-3 font-mono text-xs text-muted">{row.packId}</td>
                <td className="py-1.5 pr-3">{row.tableCount}</td>
                <td className="py-1.5 pr-3">{row.templateCount}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">
                  {(["1", "2", "3", "4", "5"] as const).map((t) => `${t}档:${row.tierOverview[t]}`).join(" ")}
                </td>
                <td className="py-1.5 pr-3 text-xs text-muted">{row.source}</td>
                <td className="py-1.5 text-xs">
                  {exposedIds === null ? (
                    <span className="text-emerald-700">已放出（默认全放）</span>
                  ) : exposedIds.has(row.packId) ? (
                    <span className="text-emerald-700">已放出</span>
                  ) : (
                    <span className="text-muted">未放出</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
