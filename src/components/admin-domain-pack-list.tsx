"use client";

// 域包列表区块（票 #60 / spec #53 目标②）：内置 + 云端（含 LLM 发布）合并展示
// 名称/packId/表数/模板数/难度五档概览/来源/放出状态。
// 数据来源：props 注入内置与云端两组注册表（页面取 builtinDomainPacks + cloudPackStore，
// 复用 #57 加载层，不加只读 API——管理页与学生端同一数据源，见施工记录的取舍说明）；
// 放出状态自查 GET /api/admin/pack-exposure（与放出管理区块同源同语义：空清单 = 默认全放）。
// 行视图口径在 domain-pack-admin-view-model 纯函数（单测锁死），本组件只渲染。
// 行内入口（票 #70 / spec #64 入口规则）：变更操作从列表进入——「微调」「版本历史」
// 携带目标基础名 ?packId= 跨页跳转（替代旧页锚点滚动，目标页读取参数自动预选）。

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bearerHeaders, getSessionAuth } from "@/lib/admin-api-client";
import { buildDomainPackListRows, type DomainPackListRow } from "@/components/domain-pack-admin-view-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DomainPack } from "@/kernel/types";

export interface AdminDomainPackListProps {
  /** 展示清单（票 #62 起由页面收敛：每个基础名只留最新版本） */
  packs: readonly DomainPack[];
  /** 内置基础名集合（来源列判定：无后缀且基础名命中 = 内置） */
  builtinBaseIds: ReadonlySet<string>;
  /** 云端就绪标记（false = 仍在拉取，列表只含内置，副注说明） */
  cloudLoaded: boolean;
}

export default function AdminDomainPackList({ packs, builtinBaseIds, cloudLoaded }: AdminDomainPackListProps) {
  const router = useRouter();
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
    exposedIds === undefined ? [] : buildDomainPackListRows(packs, builtinBaseIds, exposedIds);

  return (
    <Card asChild className="rounded-2xl border-ink/10 p-5">
      <section data-testid="域包列表" aria-label="域包列表">
        <h2 className="标题 mb-1 text-lg">域包列表</h2>
        <p className="mb-4 text-xs text-muted">
          全部可演练域包（内置随前端发布；云端含 AI 生成后发布的）。
          {!cloudLoaded && " 云端域包仍在加载……"}
        </p>
        {exposedIds === undefined || rows.length === 0 ? (
          <p className="text-sm text-muted">正在加载域包清单……</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-xs text-muted">
                <TableHead className="h-auto px-0 py-1 pr-3 font-normal">名称</TableHead>
                <TableHead className="h-auto px-0 py-1 pr-3 font-normal">packId</TableHead>
                <TableHead className="h-auto px-0 py-1 pr-3 font-normal">表数</TableHead>
                <TableHead className="h-auto px-0 py-1 pr-3 font-normal">模板数</TableHead>
                <TableHead className="h-auto px-0 py-1 pr-3 font-normal">难度五档概览</TableHead>
                <TableHead className="h-auto px-0 py-1 pr-3 font-normal">来源</TableHead>
                <TableHead className="h-auto px-0 py-1 pr-3 font-normal">放出状态</TableHead>
                <TableHead className="h-auto px-0 py-1 font-normal">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.packId} className="border-ink/5" data-testid={`域包行-${row.name}`}>
                  <TableCell className="px-0 py-1.5 pr-3">{row.name}</TableCell>
                  <TableCell className="px-0 py-1.5 pr-3 font-mono text-xs text-muted">{row.packId}</TableCell>
                  <TableCell className="px-0 py-1.5 pr-3">{row.tableCount}</TableCell>
                  <TableCell className="px-0 py-1.5 pr-3">{row.templateCount}</TableCell>
                  <TableCell className="px-0 py-1.5 pr-3 font-mono text-xs">
                    {(["1", "2", "3", "4", "5"] as const).map((t) => `${t}档:${row.tierOverview[t]}`).join(" ")}
                  </TableCell>
                  <TableCell className="px-0 py-1.5 pr-3 text-xs text-muted">{row.source}</TableCell>
                  <TableCell className="px-0 py-1.5 pr-3 text-xs">
                    {row.exposed && exposedIds === null ? (
                      <span className="text-pass">已放出（默认全放）</span>
                    ) : row.exposed ? (
                      <span className="text-pass">已放出</span>
                    ) : (
                      <span className="text-muted">未放出</span>
                    )}
                  </TableCell>
                  <TableCell className="flex gap-2 px-0 py-1.5">
                    {/* 详情入口（票 #78）：只读预览，路由含 packId 可分享直达 */}
                    <Button asChild variant="outline" size="xs">
                      <Link href={`/admin/packs/${encodeURIComponent(row.packId)}`} data-testid={`详情入口-${row.name}`}>
                        详情
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      data-testid={`微调入口-${row.name}`}
                      onClick={() => router.push(`/admin/packs/refine?packId=${encodeURIComponent(row.basePackId)}`)}
                    >
                      微调
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      data-testid={`版本历史入口-${row.name}`}
                      onClick={() => router.push(`/admin/packs/versions?packId=${encodeURIComponent(row.basePackId)}`)}
                    >
                      版本历史
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </Card>
  );
}
