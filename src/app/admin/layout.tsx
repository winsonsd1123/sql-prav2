// 后台路由组共用布局（T1 骨架，spec #41）：客户端守卫 + 侧边导航 + 返回演练场。
// 观感与演练场同一设计语言：同宽画布、宋体标题、次按钮、语义 class（卡片/标题/呼吸）。
import type { ReactNode } from "react";
import Link from "next/link";
import AdminGuard from "@/components/admin-guard";
import AdminNav from "@/components/admin-nav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-4 lg:flex-row lg:gap-6 lg:px-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 lg:sticky lg:top-4 lg:mb-0 lg:h-fit lg:flex-col lg:items-stretch">
          <h1 className="标题 text-[1.65rem] leading-none">后台管理</h1>
          <div className="flex flex-col gap-2 lg:pt-2">
            <AdminNav />
            <Link href="/" className="次按钮 px-3 py-1.5 text-xs lg:text-center">
              返回演练场
            </Link>
          </div>
        </header>
        <main className="入场 min-w-0 flex-1">{children}</main>
      </div>
    </AdminGuard>
  );
}
