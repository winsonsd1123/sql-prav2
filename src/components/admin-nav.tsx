"use client";

// 后台侧边导航（#50 起源，#65 / spec #64 改两层）：无子项的功能域（用户管理 / 邮箱白名单）第一层直达；
// 域包管理为可折叠分组（若依式子菜单，shadcn Collapsible）：分组触发器与直达项同档字号、带图标，
// 右侧 chevron 指示展开态；展开状态 localStorage 持久化，进入组内页面时自动展开。
// 选中态判定用 resolveActiveNavKey（前缀归属：生成 / 微调页高亮「域包列表」，见 admin-nav-active.ts）。
// 路由表单一数据源在 admin-nav-routes.ts（code-review 双源修复）：本组件与 active 判定均从表派生。
// 宽屏纵向排列；窄屏退化为横滑胶囊条，分组触发器作为不可点分隔呈现、子项恒显。
// #105 质感升级：菜单项左侧 lucide 图标（路由表单一数据源派生）；选中态为
// 背景高亮（半透明主色底）+ 主色文字 + 左侧 2px 圆角主色指示条（aria-current
// 页面语义保留、全侧栏唯一）；一二级同档字号，层级靠缩进与图标区分。
// #107 折叠 rail 态（仅 lg+，ADR-0012 手写折叠）：collapsed 时图标居中、label 宽度与
// 透明度同步淡变（w-0 + opacity-0，200ms）、分组触发器隐藏且子项无视分组展开态逐个直达；
// 悬停图标出 tooltip 菜单名。全部折叠类带 lg: 前缀，窄屏横滑胶囊条零波及。
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { resolveActiveNavKey } from "@/components/admin-nav-active";
import { usePackGroupOpen } from "@/components/admin-nav-group-store";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ADMIN_NAV_DIRECT_ITEMS,
  ADMIN_NAV_PACK_GROUP,
  ADMIN_NAV_PACK_GROUP_ITEMS,
  type AdminNavItem,
} from "@/components/admin-nav-routes";

/** 宽屏菜单行的共用形态：直达项、分组触发器、子项同档字号与命中区 */
const LG_ROW_CLASS =
  "lg:w-full lg:gap-1.5 lg:rounded-lg lg:px-3 lg:py-2 lg:text-sm lg:transition-all lg:duration-200";

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
      className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors duration-150 hover:bg-sidebar-hover ${LG_ROW_CLASS} ${
        collapsed ? "lg:justify-center lg:px-0 lg:gap-0" : ""
      } ${
        active
          ? "lg:bg-primary/15 font-medium text-sidebar-active"
          : "text-sidebar-fg hover:text-sidebar-bright"
      }`}
    >
      {active && (
        <span aria-hidden="true" className="absolute left-0 top-1/2 hidden h-4 -translate-y-1/2 w-[2px] rounded-full bg-sidebar-active lg:block" />
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
  const [groupOpen, setGroupOpen] = usePackGroupOpen();
  const activeInGroup = ADMIN_NAV_PACK_GROUP_ITEMS.some((item) => item.key === activeKey);
  const GroupIcon = ADMIN_NAV_PACK_GROUP.icon;

  // 仅随路由触发：进入组内页面时展开；停留期间用户仍可手动收起
  useEffect(() => {
    if (activeInGroup) setGroupOpen(true);
  }, [pathname, activeInGroup, setGroupOpen]);

  return (
    <nav
      className="横滑 flex items-center gap-1 overflow-x-auto lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible"
      data-testid="后台侧边导航"
      aria-label="后台导航"
    >
      {ADMIN_NAV_DIRECT_ITEMS.map((item) => (
        <NavLink key={item.key} item={item} active={activeKey === item.key} collapsed={collapsed} />
      ))}
      {/* 窄屏 contents 让分隔与子项并入横滑行；宽屏展开组铺深一档底色 + 左侧主色竖线（内阴影不占宽，展开/收起不位移） */}
      <Collapsible
        open={groupOpen}
        onOpenChange={setGroupOpen}
        className={`contents lg:block lg:mt-0.5 ${
          collapsed ? "" : "lg:rounded-r-lg lg:data-[state=open]:bg-sidebar-sub lg:data-[state=open]:shadow-[inset_2px_0_0_var(--color-sidebar-active)]"
        }`}
      >
        {/* 窄屏分组不可折叠：以纯文字分隔呈现，触发器 display:none 退出 Tab 序列 */}
        <span className="flex items-center whitespace-nowrap px-3 py-1 text-[10px] font-medium tracking-wider text-sidebar-fg lg:hidden">
          {ADMIN_NAV_PACK_GROUP.label}
        </span>
        <CollapsibleTrigger
          data-testid="导航分组-域包管理"
          className={`group items-center whitespace-nowrap font-medium text-sidebar-fg lg:cursor-pointer lg:hover:bg-sidebar-hover lg:hover:text-sidebar-bright ${LG_ROW_CLASS} ${
            collapsed ? "hidden" : "hidden lg:flex"
          }`}
        >
          <GroupIcon aria-hidden="true" className="size-4 shrink-0" />
          {ADMIN_NAV_PACK_GROUP.label}
          <ChevronDown
            aria-hidden="true"
            className="ml-auto size-4 shrink-0 transition-transform duration-200 group-data-[state=closed]:-rotate-90"
          />
        </CollapsibleTrigger>
        {/* forceMount：子项恒在 DOM，仅宽屏展开态按 data-state 收起；窄屏与 rail 态恒直达 */}
        <CollapsibleContent
          forceMount
          className={`flex items-center gap-1 lg:flex-col lg:items-stretch lg:gap-0.5 lg:pb-1 ${
            collapsed ? "" : "lg:pl-4 lg:data-[state=closed]:hidden"
          }`}
        >
          {ADMIN_NAV_PACK_GROUP_ITEMS.map((item) => (
            <NavLink key={item.key} item={item} active={activeKey === item.key} collapsed={collapsed} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </nav>
  );
}
