"use client";

// 进度云同步挂载 hook（T6 issue #28）：登录守卫内调用——
// 有登录态即启动「判定后节流云写 + 断网静默重试 + 会话恢复云端拉取」，
// 无登录态/读取失败均静默，学生本地行为（localStorage 即时缓存）不受影响。
import { useEffect } from "react";
import { browserClient } from "@/lib/supabase/browser-client";
import { createProgressSync } from "@/lib/progress-cloud-sync";

/** 登录后启动进度云同步（零 UI）；未登录/登录态读取失败静默不同步（守卫会重定向） */
export function useProgressSync(): void {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    browserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled || data.session === null) return; // 未登录不同步（守卫会重定向）
        const sync = createProgressSync(data.session.user.id);
        sync.start();
        stop = sync.stop;
      })
      .catch(() => {}); // 登录态读取失败静默：本地进度照常工作
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
}
