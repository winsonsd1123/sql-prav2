"use client";

// 当前用户权限点加载（T5，spec #22「角色与权限」）：登录后经浏览器客户端读取
// user_roles → role_permissions 两跳，按多角色并集汇总（判定见 lib/permissions）。
// 安全默认：任何失败（表未建/网络异常/未登录）回退空权限集合 = 学生行为（摩擦力规则不变）。
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser-client";
import { EMPTY_PERMISSIONS, mergePermissions, type PermissionName } from "@/lib/permissions";

/** 加载接缝（依赖注入，测试可替换）：会话用户 id → 各角色的权限点集合 */
export async function fetchUserRolePermissions(userId: string): Promise<string[][]> {
  const client = browserClient();
  const rolesResult = await client.from("user_roles").select("*").eq("user_id", userId);
  const roleList = ((rolesResult.data ?? []) as { role: string }[]).map((row) => row.role);
  if (roleList.length === 0) return [];
  const permissionsResult = await client.from("role_permissions").select("*").in("role", roleList);
  const permissionRows = (permissionsResult.data ?? []) as { role: string; permission: string }[];
  return roleList.map((role) =>
    permissionRows.filter((row) => row.role === role).map((row) => row.permission),
  );
}

/** 当前登录用户的权限点集合（多角色并集）；加载完成前与失败时均为空集合（安全默认） */
export function usePermissions(): ReadonlySet<PermissionName | string> {
  const [permissionSet, setPermissionSet] = useState<ReadonlySet<PermissionName | string>>(EMPTY_PERMISSIONS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await browserClient().auth.getSession();
        const userId = data.session?.user?.id;
        if (!userId || cancelled) return;
        const rolePermissions = await fetchUserRolePermissions(userId);
        if (!cancelled) setPermissionSet(mergePermissions(rolePermissions));
      } catch {
        // 回退空集合：无权限点者一律走摩擦力（学生行为）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return permissionSet;
}
