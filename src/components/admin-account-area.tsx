"use client";

// 后台侧栏「账户与出口」区（#51，spec #49）：当前登录邮箱 + 返回演练场 + 登出。
// 全应用第一个主动登出入口：signOut 成功后引导回登录页（同改密流程的登出引导）。
// 宽屏纵排（标签 / 邮箱 / 两按钮同行）；窄屏为一行：左邮箱、右两按钮。
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser-client";
import { Button } from "@/components/ui/button";

export default function AdminAccountArea() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    browserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setEmail(data.session?.user?.email ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onSignOut = async () => {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      const { error } = await browserClient().auth.signOut();
      if (!error) {
        router.replace("/login");
        return;
      }
    } catch {
      // 网络异常同失败处理
    }
    setSignOutFailed(true);
    setSigningOut(false);
  };

  return (
    <div
      className="flex basis-full flex-wrap items-center gap-x-3 gap-y-2 border-t border-sidebar-divider pt-3 lg:basis-auto lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-3 lg:pt-4"
      data-testid="后台账户区"
    >
      <div className="min-w-0 flex-1 lg:flex-none">
        <p className="hidden text-[11px] text-sidebar-fg lg:block">当前登录</p>
        <p
          className="min-h-4 truncate font-mono text-xs text-sidebar-fg lg:mt-1"
          title={email ?? undefined}
          data-testid="当前账户邮箱"
        >
          {email}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button asChild variant="outline" size="sm" className="px-3 lg:h-8 lg:flex-1">
          <Link href="/">返回演练场</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="px-3 lg:h-8"
          onClick={onSignOut}
          disabled={signingOut}
          data-testid="登出按钮"
        >
          {signingOut ? "登出中…" : "登出"}
        </Button>
      </div>
      {signOutFailed && (
        <p className="basis-full text-[11px] text-fail" role="alert">
          登出失败，请重试
        </p>
      )}
    </div>
  );
}
