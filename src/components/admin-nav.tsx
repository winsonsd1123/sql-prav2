"use client";

// 后台侧边导航（#50 起源，#65 / spec #64 改两层）：无子项的功能域（用户管理 / 邮箱白名单）第一层直达；
// 域包管理为分组第一层，子功能点常显（不折叠——导航总量小，直接展示最简）。
// 本票挂全四子项（#65 骨架，#70 补 versions / exposure / practice-config）。
// 选中态判定用 resolveActiveNavKey（前缀归属：生成 / 微调页高亮「域包列表」，见 admin-nav-active.ts）。
// 路由表单一数据源在 admin-nav-routes.ts（code-review 双源修复）：本组件与 active 判定均从表派生。
// 宽屏纵向排列；窄屏退化为横滑胶囊条，分组标题作为不可点分隔呈现。
// #105 质感升级：菜单项左侧 lucide 图标（路由表单一数据源派生）；选中态为
// 背景高亮（半透明主色底）+ 主色文字 + 左侧 2px 圆角主色指示条（aria-current
// 页面语义保留、全侧栏唯一）；一二级同档字号，层级靠缩进与图标区分。
// #107 折叠 rail 态（仅 lg+，ADR-0012 手写折叠）：collapsed 时图标居中、label 宽度与
// 透明度同步淡变（w-0 + opacity-0，200ms）、组标题隐藏；悬停图标出 tooltip 菜单名。
// 全部折叠类带 lg: 前缀，窄屏横滑胶囊条零波及。
import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveActiveNavKey } from "@/components/admin-nav-active";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ADMIN_NAV_DIRECT_ITEMS, ADMIN_NAV_PACK_GROUP_ITEMS, type AdminNavItem } from "@/components/admin-nav-routes";

type NavLinkProps = {
  item: AdminNavItem;
  active: boolean;
  /** lg+ 折叠 rail 态（#107）：图标居中 + label 隐藏 + tooltip 菜单名；窄屏不生效 */
  collapsed?: boolean;
};

function NavLink({ item, active, collapsed = false }: NavLinkProps) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors duration-150 hover:bg-sidebar-hover lg:rounded-lg lg:py-2 lg:text-sm lg:transition-all lg:duration-200 ${
        collapsed ? "lg:justify-center lg:px-0" : ""
      } ${
        active
          ? "bg-primary/15 font-medium text-sidebar-active"
          : "text-sidebar-fg hover:text-sidebar-bright"
      }`}
    >
      {active && (
        <span aria-hidden="true" className="absolute left-0 top-1/2 h-4 -translate-y-1/2 w-[2px] rounded-full bg-sidebar-active" />
      )}
      <Icon aria-hidden="true" className="size-3.5 shrink-0 lg:size-4" />
      <span
        className={`lg:transition-all lg:duration-200 ${
          collapsed
            ? "lg:w-0 lg:overflow-hidden lg:opacity-0"
            : "lg:opacity-100"
        }`}
      >
        {item.label}
      </span>
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

export default function AdminNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const activeKey = resolveActiveNavKey(pathname);
  return (
    <nav
      className="横滑 flex items-center gap-1 overflow-x-auto lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible"
      data-testid="后台侧边导航"
      aria-label="后台导航"
    >
      {ADMIN_NAV_DIRECT_ITEMS.map((item) => (
        <NavLink key={item.key} item={item} active={activeKey === item.key} collapsed={collapsed} />
      ))}
      {/* 分组第一层：不可点分隔（窄屏）+ 小节标题（宽屏）；子项常显；rail 态隐藏（lg:hidden 不影响窄屏分隔） */}
      <span
        data-testid="导航分组-域包管理"
        className={`flex items-center gap-1 whitespace-nowrap px-3 py-1 text-xs font-medium uppercase tracking-wider text-sidebar-fg lg:mt-2 lg:px-3 lg:py-1 ${
          collapsed ? "lg:hidden" : ""
        }`}
      >
        域包管理
      </span>
      <div
        className={`flex items-center gap-1 lg:flex-col lg:gap-0.5 lg:rounded-lg lg:bg-sidebar-sub lg:py-1 lg:pl-2 ${
          collapsed ? "lg:pl-0" : ""
        }`}
      >
        {ADMIN_NAV_PACK_GROUP_ITEMS.map((item) => (
          <NavLink key={item.key} item={item} active={activeKey === item.key} collapsed={collapsed} />
        ))}
      </div>
    </nav>
  );
}
