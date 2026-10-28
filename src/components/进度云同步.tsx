"use client";

// 进度云同步挂载 hook（T6 issue #28）：登录守卫内调用——
// 有登录态即启动「判定后节流云写 + 断网静默重试 + 会话恢复云端拉取」，
// 无登录态/读取失败均静默，学生本地行为（localStorage 即时缓存）不受影响。
// 命名随 usePermissions 例外约定（rules-of-hooks 需 ASCII use 前缀）。
import { useEffect } from "react";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";
import { 创建进度同步 } from "@/lib/进度云同步";

/** 登录后启动进度云同步（零 UI）；未登录/登录态读取失败静默不同步（守卫会重定向） */
export function useProgressSync(): void {
  useEffect(() => {
    let 停止: (() => void) | null = null;
    let 已取消 = false;
    浏览器客户端()
      .auth.getSession()
      .then(({ data }) => {
        if (已取消 || data.session === null) return; // 未登录不同步（守卫会重定向）
        const 同步 = 创建进度同步(data.session.user.id);
        同步.启动();
        停止 = 同步.停止;
      })
      .catch(() => {}); // 登录态读取失败静默：本地进度照常工作
    return () => {
      已取消 = true;
      停止?.();
    };
  }, []);
}
