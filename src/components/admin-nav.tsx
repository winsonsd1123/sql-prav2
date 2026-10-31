"use client";

// 后台侧边导航（T1 骨架，spec #41）：用户管理 / 邮箱白名单 两项，当前项高亮。
// 风格照演练场题目导航（卡片容器 + rounded-full 高亮切换，语义 class）。
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/whitelist", label: "邮箱白名单" },
] as const;

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="卡片 横滑 flex gap-1 overflow-x-auto p-2" data-testid="后台侧边导航" aria-label="后台导航">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
              active ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
