"use client";

// 登录守卫（客户端）：未登录访问演练场一律重定向登录页（spec #22 story 13）。
// 登录态判定基于浏览器客户端的登录态存储（PKCE 单例）；判定完成前不渲染内容，避免演练场闪现。
// 守卫内挂载进度云同步（登录后即启动；未登录静默，由守卫重定向兜底）。
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";
import { useProgressSync } from "@/components/进度云同步";

export default function LoginGuard({ children }: { children: ReactNode }) {
  const 路由 = useRouter();
  const [已确认, 设已确认] = useState(false);
  useProgressSync();

  useEffect(() => {
    let 取消 = false;
    浏览器客户端()
      .auth.getSession()
      .then(({ data }) => {
        if (取消) return;
        if (data.session === null) 路由.replace("/login");
        else 设已确认(true);
      })
      .catch(() => {
        if (!取消) 路由.replace("/login");
      });
    return () => {
      取消 = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!已确认) {
    return <p className="呼吸 m-auto text-sm text-muted" data-testid="会话检查中">正在确认登录态…</p>;
  }
  return <>{children}</>;
}
