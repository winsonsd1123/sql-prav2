// 后台路由组共用布局（#50 / #51，spec #49）：客户端守卫 + 全高侧栏（品牌区 / 纵向菜单 / 账户与出口区）+ 自适应内容区。
// 窄屏（<lg）侧栏退化为顶部卡片，三段按 DOM 顺序各占一行：品牌、横排菜单、账户与出口。
// 侧栏换若依深色皮肤（#93）：底 / 文字 / 右向投影走侧栏 token，布局与窄屏退化不变。
// #107：侧栏结构（aside + 折叠状态）下沉为客户端组件 AdminSidebar（折叠仅 lg+ 生效，
// ADR-0012 手写轻量实现），本布局只保留守卫与内容区框架。
import type { ReactNode } from "react";
import AdminGuard from "@/components/admin-guard";
import AdminSidebar from "@/components/admin-sidebar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <div className="flex min-h-screen flex-col gap-4 p-4 lg:flex-row lg:gap-6">
        <AdminSidebar />
        <main className="入场 入场-2 min-w-0 flex-1">{children}</main>
      </div>
    </AdminGuard>
  );
}
