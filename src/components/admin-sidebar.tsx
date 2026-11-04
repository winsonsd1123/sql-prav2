"use client";

// 后台侧栏容器（#107 / spec #104 / ADR-0012 手写轻量折叠）：宽屏（lg+）可折叠为
// 约 64px 图标栏——折叠按钮在品牌区（testid「侧栏折叠按钮」+ aria-expanded），
// 宽度 200ms ease 过渡、文字与图标透明度同步淡变；折叠状态 localStorage 持久化、
// 首次默认展开。rail 态品牌区收为仅 logo（tooltip「后台管理」）。窄屏（<lg）顶部
// 横滑胶囊条形态零波及（折叠仅 lg 生效，全部折叠类带 lg: 前缀）。入场动画（入场）
// 由原 layout 原样保留在 aside 上。
import { useSyncExternalStore } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import AdminAccountArea from "@/components/admin-account-area";
import AdminNav from "@/components/admin-nav";
import BrandLogo from "@/components/brand-logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 折叠状态持久化 key（"1" = 折叠 / "0" = 展开；缺省即首次默认展开） */
const SIDEBAR_COLLAPSED_STORAGE_KEY = "admin.sidebar.collapsed";

// 折叠状态走 useSyncExternalStore + localStorage（仓库既有模式，见 local-storage.ts 头注释）：
// SSR 快照恒为展开（false），挂载后取客户端真值，天然免水合闪烁；
// 本组件切换即写入并唤醒订阅，跨标签页经 storage 事件同步。
const collapseListeners = new Set<() => void>();
const subscribeCollapse = (callback: () => void) => {
  collapseListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    collapseListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
};
const getCollapsedSnapshot = () =>
  window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
const getCollapsedServerSnapshot = () => false;
const writeCollapsed = (collapsed: boolean) => {
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  collapseListeners.forEach((notify) => notify());
};

export default function AdminSidebar() {
  const collapsed = useSyncExternalStore(
    subscribeCollapse,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot
  );

  const toggleCollapsed = () => writeCollapsed(!collapsed);

  return (
    <aside
      className={`入场 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sidebar p-3 text-sidebar-fg shadow-sidebar lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)] lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:justify-start lg:gap-0 lg:transition-[width] lg:duration-200 lg:ease-in-out ${
        collapsed ? "lg:w-16 lg:p-3" : "lg:w-60 lg:p-5"
      }`}
      data-testid="后台侧栏"
    >
      {/* 品牌区：展开 logo + 标题 + 折叠按钮；rail 态收为仅 logo（tooltip「后台管理」）+ 折叠按钮 */}
      <div
        className={`flex items-center gap-2.5 lg:pb-5 ${
          collapsed ? "lg:flex-col lg:gap-2" : ""
        }`}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex lg:justify-center">
                <BrandLogo size={28} className="shrink-0 text-sidebar-fg" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">后台管理</TooltipContent>
          </Tooltip>
        ) : (
          <BrandLogo size={28} className="shrink-0 text-sidebar-fg" />
        )}
        {/* heading 语义保留为既有 e2e 锚点（admin-console.spec）；rail 态仅隐藏视觉 */}
        <h1
          className={`标题 text-lg leading-none ${collapsed ? "lg:hidden" : ""}`}
        >
          后台管理
        </h1>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
          data-testid="侧栏折叠按钮"
          className={`hidden size-7 items-center justify-center rounded-md text-sidebar-fg transition-colors duration-150 hover:bg-sidebar-hover hover:text-sidebar-bright lg:inline-flex ${
            collapsed ? "" : "lg:ml-auto"
          }`}
        >
          {collapsed ? (
            <ChevronsRight aria-hidden="true" className="size-4" />
          ) : (
            <ChevronsLeft aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      <div className="basis-full border-t border-sidebar-divider pt-3 lg:flex-1 lg:basis-auto lg:pt-4">
        <AdminNav collapsed={collapsed} />
      </div>
      <AdminAccountArea collapsed={collapsed} />
      </aside>
  );
}
