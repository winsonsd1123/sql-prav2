"use client";

// 域包管理权限守卫（票 #78 / spec #73）：spec 要求详情页沿用「访问后台」+「域包管理」
// 双权限点判定——「访问后台」由 admin 布局守卫拦截（体验层），本组件补「域包管理」
// 页内拦截：无此权限点重定向回域包列表（不回演练场，教师仍是后台用户）。
// 判定完成前不渲染内容（与 admin-guard 同口径，避免骨架闪现）；读取失败回退空集合
// = 无权限（安全默认）。真正的安全边界在管理 API（ADR-0007），本组件只管理界面可达性。
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { fetchUserRolePermissions } from "@/components/current-permissions";
import { getSessionAuth } from "@/lib/admin-api-client";
import { hasPermission, mergePermissions, PERMISSIONS } from "@/lib/permissions";

export default function AdminPackManageGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { userId } = await getSessionAuth();
        if (cancelled) return;
        // 未登录由布局守卫负责，此处不重复处置；已登录仅判「域包管理」
        if (userId) {
          const rolePermissions = await fetchUserRolePermissions(userId);
          if (cancelled) return;
          // 词汇对照：PERMISSIONS.packExposure 的值即「域包管理」权限点（lib/permissions 命名历史遗留）
          if (!hasPermission(mergePermissions(rolePermissions), PERMISSIONS.packExposure)) {
            router.replace("/admin/packs");
            return;
          }
        }
        setAllowed(true);
      } catch {
        // 权限读取失败：按无权限处理（安全默认，回列表页）
        if (!cancelled) router.replace("/admin/packs");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!allowed) {
    return <p className="呼吸 m-auto text-sm text-muted" data-testid="域包管理权限检查中">正在确认权限…</p>;
  }
  return <>{children}</>;
}
