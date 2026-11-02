"use client";

// 后台侧边导航（#50 起源，#65 / spec #64 改两层）：无子项的功能域（用户管理 / 邮箱白名单）第一层直达；
// 域包管理为分组第一层，子功能点常显（不折叠——导航总量小，直接展示最简）。
// 本票挂全四子项（#65 骨架，#70 补 versions / exposure / practice-config）。
// 选中态判定用 resolveActiveNavKey（前缀归属：生成 / 微调页高亮「域包列表」，见 admin-nav-active.ts）。
// 宽屏纵向排列、当前项左侧竖条；窄屏退化为横滑胶囊条，分组标题作为不可点分隔呈现。
import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveActiveNavKey } from "@/components/admin-nav-active";

const directItems = [
  { key: "users", href: "/admin/users", label: "用户管理" },
  { key: "whitelist", href: "/admin/whitelist", label: "邮箱白名单" },
] as const;

// 域包管理组子项（#70 挂全四项：列表占根路径，历史/放出/配置巡检式导航直达；
// 生成 / 微调页不在导航列示，active 前缀归属「域包列表」——见 admin-nav-active.ts）
const packGroupItems = [
  { key: "packs-list", href: "/admin/packs", label: "域包列表" },
  { key: "packs-versions", href: "/admin/packs/versions", label: "版本历史" },
  { key: "packs-exposure", href: "/admin/packs/exposure", label: "放出管理" },
  { key: "packs-practice-config", href: "/admin/packs/practice-config", label: "演练配置" },
] as const;

type NavLinkProps = {
  href: string;
  label: string;
  active: boolean;
};

function NavLink({ href, label, active }: NavLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors duration-150 lg:rounded-lg lg:py-2 lg:text-sm ${
        active ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 hidden w-0.5 rounded-full bg-ink lg:block"
        />
      )}
      {label}
    </Link>
  );
}

export default function AdminNav() {
  const pathname = usePathname();
  const activeKey = resolveActiveNavKey(pathname);
  return (
    <nav
      className="横滑 flex items-center gap-1 overflow-x-auto lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible"
      data-testid="后台侧边导航"
      aria-label="后台导航"
    >
      {directItems.map((item) => (
        <NavLink key={item.key} href={item.href} label={item.label} active={activeKey === item.key} />
      ))}
      {/* 分组第一层：不可点分隔（窄屏）+ 小节标题（宽屏）；子项常显 */}
      <span
        data-testid="导航分组-域包管理"
        className="flex items-center gap-1 whitespace-nowrap px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted lg:mt-2 lg:px-3 lg:py-1 lg:text-[10px]"
      >
        域包管理
      </span>
      <div className="flex items-center gap-1 lg:flex-col lg:gap-0.5 lg:pl-2">
        {packGroupItems.map((item) => (
          <NavLink
            key={item.key}
            href={item.href}
            label={item.label}
            active={activeKey === item.key}
          />
        ))}
      </div>
    </nav>
  );
}
