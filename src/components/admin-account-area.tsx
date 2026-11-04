"use client";

// 后台侧栏「账户与出口」区（#51，spec #49）：当前登录邮箱 + 返回演练场 + 登出。
// 全应用第一个主动登出入口：signOut 成功后引导回登录页（同改密流程的登出引导）。
// 宽屏纵排（标签 / 邮箱 / 两按钮同行）；窄屏为一行：左邮箱、右两按钮。
// #108 rail 态图标化（仅 lg+）：邮箱收为用户图标（tooltip 显邮箱，图标元素承载
// testid「当前账户邮箱」）、登出收为 LogOut 图标（tooltip「登出」）、返回演练场收为
// ExternalLink 图标（tooltip「返回演练场」）、「当前登录」标签隐藏。rail 分支按
// collapsed 条件渲染（否则与展开态同 testid 双份在 DOM 破坏断言），展开态块在
// collapsed 时仅 lg 隐藏、窄屏照常可用。tooltip 沿用每 Tooltip 自带 Provider 约定
// （见 ui/tooltip.tsx 注释）。字号归一：账户区无任意值字号，全部标准档（text-xs）。
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, LogOut, User } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser-client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** rail 态图标触发器的统一形态：8px 级命中区 + 悬停高亮（与导航菜单项同档） */
const RAIL_TRIGGER_CLASS =
  "flex size-8 items-center justify-center rounded-lg text-sidebar-fg transition-colors duration-150 hover:bg-sidebar-hover hover:text-sidebar-bright";

export default function AdminAccountArea({ collapsed = false }: { collapsed?: boolean }) {
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
      {/* 展开态块（窄屏任何折叠状态下均可用；collapsed 时仅 lg 隐藏） */}
      <div className={`min-w-0 flex-1 lg:flex-none ${collapsed ? "lg:hidden" : ""}`}>
        <p className="hidden text-[11px] text-sidebar-fg lg:block lg:text-xs">当前登录</p>
        <p
          className="min-h-4 truncate font-mono text-xs text-sidebar-fg lg:mt-1"
          title={email ?? undefined}
          data-testid="当前账户邮箱"
        >
          {email}
        </p>
      </div>
      <div className={`flex shrink-0 gap-2 ${collapsed ? "lg:hidden" : ""}`}>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="px-3 text-xs lg:h-8 lg:flex-1"
        >
          <Link href="/">返回演练场</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="px-3 text-xs lg:h-8"
          onClick={onSignOut}
          disabled={signingOut}
          data-testid="登出按钮"
        >
          {signingOut ? "登出中…" : "登出"}
        </Button>
      </div>
      {/* rail 态块（仅 lg+ 且 collapsed 时渲染；图标元素承载既有 testid） */}
      {collapsed && (
        <div className="hidden flex-col items-center gap-1 lg:flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={RAIL_TRIGGER_CLASS}
                data-testid="当前账户邮箱"
                aria-label="当前账户邮箱"
              >
                <User aria-hidden="true" className="size-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{email}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/" className={RAIL_TRIGGER_CLASS} aria-label="返回演练场">
                <ExternalLink aria-hidden="true" className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">返回演练场</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={RAIL_TRIGGER_CLASS}
                onClick={onSignOut}
                disabled={signingOut}
                data-testid="登出按钮"
                aria-label="登出"
              >
                <LogOut aria-hidden="true" className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">登出</TooltipContent>
          </Tooltip>
        </div>
      )}
      {signOutFailed && (
        <p className={`basis-full text-[11px] text-fail lg:text-xs ${collapsed ? "lg:hidden" : ""}`} role="alert">
          登出失败，请重试
        </p>
      )}
    </div>
  );
}
