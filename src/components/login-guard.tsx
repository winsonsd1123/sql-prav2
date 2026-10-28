"use client";

// 登录守卫（客户端）：未登录访问演练场一律重定向登录页（spec #22 story 13）。
// 登录态判定基于浏览器客户端的登录态存储（PKCE 单例）；判定完成前不渲染内容，避免演练场闪现。
// 守卫内挂载进度云同步（登录后即启动；未登录静默，由守卫重定向兜底）。
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser-client";
import { useProgressSync } from "@/components/progress-cloud-sync";

export default function LoginGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  useProgressSync();

  useEffect(() => {
    let cancelled = false;
    browserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session === null) router.replace("/login");
        else setConfirmed(true);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!confirmed) {
    return <p className="呼吸 m-auto text-sm text-muted" data-testid="会话检查中">正在确认登录态…</p>;
  }
  return <>{children}</>;
}
