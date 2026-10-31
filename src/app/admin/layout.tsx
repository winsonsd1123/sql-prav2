// 后台路由组共用布局（#50，spec #49）：客户端守卫 + 全高侧栏（品牌区 / 纵向菜单 / 底部出口）+ 自适应内容区。
// 窄屏（<lg）侧栏退化为顶部卡片：品牌与返回入口一行、菜单横排一行。
// 观感与演练场同一设计语言：宋体标题、次按钮、语义 class（卡片/标题/入场）。
import type { ReactNode } from "react";
import Link from "next/link";
import AdminGuard from "@/components/admin-guard";
import AdminNav from "@/components/admin-nav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <div className="flex min-h-screen flex-col gap-4 p-4 lg:flex-row lg:gap-6">
        <aside
          className="卡片 入场 flex flex-wrap items-center justify-between gap-3 p-3 lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)] lg:w-60 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:justify-start lg:gap-0 lg:p-5"
          data-testid="后台侧栏"
        >
          <div className="lg:pb-5">
            <h1 className="标题 text-[1.4rem] leading-none">后台管理</h1>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              Admin Console
            </p>
          </div>
          <div className="order-last basis-full border-t border-border-strong pt-3 lg:order-none lg:flex-1 lg:basis-auto lg:pt-4">
            <AdminNav />
          </div>
          <div className="lg:border-t lg:border-border-strong lg:pt-4">
            <Link href="/" className="次按钮 block px-3 py-1.5 text-xs lg:py-2 lg:text-center">
              返回演练场
            </Link>
          </div>
        </aside>
        <main className="入场 入场-2 min-w-0 flex-1">{children}</main>
      </div>
    </AdminGuard>
  );
}
