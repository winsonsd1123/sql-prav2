"use client";

// 域包列表页（票 #70 / spec #64）：/admin/packs 从六区块混排旧页换成纯列表页——
// 每个子功能点独占各自路由（generate / refine / versions / exposure / practice-config），
// 本页只承载域包现状概览。入口规则（变更操作从列表进入）：页顶「新建域包」→ 生成页；
// 行内「微调」「版本历史」携带 ?packId= 跨页跳转（组件内接线，目标页自动预选）。
// 旧六区块页与锚点滚动机制已删除，不做兼容重定向（内部工具，无外部书签负担）。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）。
// 云端清单复用 #57 加载层（cloudPackStore，RLS authenticated 可读），不另建管理端只读 API；
// 展示清单按基础名收敛为最新版本（票 #62：微调出新版本后列表该行即新版本）。
import Link from "next/link";
import AdminDomainPackList from "@/components/admin-domain-pack-list";
import { Button } from "@/components/ui/button";
import { builtinDomainPacks } from "@/components/domain-pack-registry";
import { useDisplayPacks } from "@/components/use-display-packs";

export default function AdminPacksPage() {
  // 云端域包快照（#57 加载层）：未就绪时只展示内置两包，副注说明仍在加载；
  // 展示清单（票 #62）：合并后按基础名只留最新版本
  const { cloud, displayPacks } = useDisplayPacks();
  const builtinBaseIds = new Set(builtinDomainPacks.map((d) => d.packId));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="标题 text-lg">域包列表</h1>
        {/* 入口规则：生成 = 目标明确的变更操作，从列表页顶进入独立生成页 */}
        <Button asChild className="px-3">
          <Link href="/admin/packs/generate" data-testid="新建域包入口">
            新建域包
          </Link>
        </Button>
      </div>
      <AdminDomainPackList
        packs={displayPacks}
        builtinBaseIds={builtinBaseIds}
        cloudLoaded={cloud.loaded}
      />
    </div>
  );
}
