"use client";

// 后台守卫（客户端，体验层，ADR-0007 / GLOSSARY「后台管理」）：
// 未登录 → 引导登录页；已登录无「访问后台」权限点 → 重定向回演练场。
// 权限加载复用 current-permissions 的两跳接缝（多角色并集）；
// 任何失败回退空集合 = 无权限（安全默认）。判定完成前不渲染内容，避免骨架闪现。
// 真正的安全边界在服务端管理 API（后续票），本组件只管理界面可达性。
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser-client";
import { fetchUserRolePermissions } from "@/components/current-permissions";
import { hasPermission, mergePermissions, PERMISSIONS } from "@/lib/permissions";

export default function AdminGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await browserClient().auth.getSession();
        const userId = data.session?.user?.id;
        if (cancelled) return;
        if (!userId) {
          router.replace("/login");
          return;
        }
        const rolePermissions = await fetchUserRolePermissions(userId);
        if (cancelled) return;
        if (!hasPermission(mergePermissions(rolePermissions), PERMISSIONS.adminConsole)) {
          router.replace("/");
          return;
        }
        setAllowed(true);
      } catch {
        // 会话或权限读取失败：按无权限处理（安全默认，回演练场）
        if (!cancelled) router.replace("/");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!allowed) {
    return <p className="呼吸 m-auto text-sm text-muted" data-testid="后台权限检查中">正在确认登录态…</p>;
  }
  return <>{children}</>;
}
