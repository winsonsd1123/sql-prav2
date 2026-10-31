"use client";

// 后台侧边导航（#50，spec #49）：用户管理 / 邮箱白名单 两项，当前项高亮。
// 宽屏纵向排列、当前项左侧竖条；窄屏退化为横滑胶囊条（同演练场题目导航）。容器卡片由侧栏提供。
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/whitelist", label: "邮箱白名单" },
] as const;

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav
      className="横滑 flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible"
      data-testid="后台侧边导航"
      aria-label="后台导航"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
