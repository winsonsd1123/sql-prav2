"use client";

// 登录守卫（客户端）：未登录访问演练场一律重定向登录页（spec #22 story 13）。
// 登录态判定基于浏览器客户端的会话状态（PKCE 单例存储）；判定完成前不渲染内容，避免演练场闪现。
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";

export default function LoginGuard({ children }: { children: ReactNode }) {
  const 路由 = useRouter();
  const [已确认, 设已确认] = useState(false);

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
