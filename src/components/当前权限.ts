"use client";

// 当前用户权限点加载（T5，spec #22「角色与权限」）：登录后经浏览器客户端读取
// 用户-角色 → 角色-权限 两跳，按多角色并集汇总（判定见 lib/权限）。
// 安全默认：任何失败（表未建/网络异常/未登录）回退空权限集合 = 学生行为（摩擦力规则不变）。
import { useEffect, useState } from "react";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";
import { 空权限集合, 汇总权限点, type 权限点名 } from "@/lib/权限";

/** 加载接缝（依赖注入，测试可替换）：会话用户 id → 各角色的权限点集合 */
export async function 取用户各角色权限(用户id: string): Promise<string[][]> {
  const 客户端 = 浏览器客户端();
  // supabase select 解析器不认中文列名，统一 select("*") 后按断言取值（同 白名单服务）
  const 角色结果 = await 客户端.from("用户-角色").select("*").eq("用户", 用户id);
  const 角色列表 = ((角色结果.data ?? []) as { 角色: string }[]).map((行) => 行.角色);
  if (角色列表.length === 0) return [];
  const 权限结果 = await 客户端.from("角色-权限").select("*").in("角色", 角色列表);
  const 权限行 = (权限结果.data ?? []) as { 角色: string; 权限点: string }[];
  return 角色列表.map((角色) =>
    权限行.filter((行) => 行.角色 === 角色).map((行) => 行.权限点),
  );
}

/** 当前登录用户的权限点集合（多角色并集）；加载完成前与失败时均为空集合（安全默认） */
export function usePermissions(): ReadonlySet<权限点名 | string> {
  const [权限点集合, 设权限点集合] = useState<ReadonlySet<权限点名 | string>>(空权限集合);

  useEffect(() => {
    let 取消 = false;
    (async () => {
      try {
        const { data } = await 浏览器客户端().auth.getSession();
        const 用户id = data.session?.user?.id;
        if (!用户id || 取消) return;
        const 各角色权限 = await 取用户各角色权限(用户id);
        if (!取消) 设权限点集合(汇总权限点(各角色权限));
      } catch {
        // 回退空集合：无权限点者一律走摩擦力（学生行为）
      }
    })();
    return () => {
      取消 = true;
    };
  }, []);

  return 权限点集合;
}
