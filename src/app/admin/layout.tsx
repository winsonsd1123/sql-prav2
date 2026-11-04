// 后台路由组共用布局（#50 / #51，spec #49）：客户端守卫 + 全高侧栏（品牌区 / 纵向菜单 / 账户与出口区）+ 自适应内容区。
// 窄屏（<lg）侧栏退化为顶部卡片，三段按 DOM 顺序各占一行：品牌、横排菜单、账户与出口。
// 侧栏换若依深色皮肤（#93）：底 / 文字 / 右向投影走侧栏 token，布局与窄屏退化不变。
import type { ReactNode } from "react";
import AdminAccountArea from "@/components/admin-account-area";
import AdminGuard from "@/components/admin-guard";
import BrandLogo from "@/components/brand-logo";
import AdminNav from "@/components/admin-nav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <div className="flex min-h-screen flex-col gap-4 p-4 lg:flex-row lg:gap-6">
        <aside
          className="入场 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sidebar p-3 text-sidebar-fg shadow-sidebar lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)] lg:w-60 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:justify-start lg:gap-0 lg:p-5"
          data-testid="后台侧栏"
        >
          {/* #106 品牌区：SVG logo + 标题横排，字号收敛 text-lg，副标已删除（heading 语义保留为既有 e2e 锚点） */}
          <div className="flex items-center gap-2.5 lg:pb-5">
            <BrandLogo size={28} className="shrink-0 text-sidebar-fg" />
            <h1 className="标题 text-lg leading-none">后台管理</h1>
          </div>
          <div className="basis-full border-t border-sidebar-divider pt-3 lg:flex-1 lg:basis-auto lg:pt-4">
            <AdminNav />
          </div>
          <AdminAccountArea />
        </aside>
        <main className="入场 入场-2 min-w-0 flex-1">{children}</main>
      </div>
    </AdminGuard>
  );
}
