"use client";

// 邮箱验证回调：验证邮件链接落地页（?code=…，PKCE），手动 exchangeCodeForSession 换会话并呈现成功/失败态。
// 密码重置链接也走此回调：PKCE verifier 带 recovery 标记时换会话后转入 /reset-password。
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser-client";

type CallbackState = "换会话中" | "成功" | "失败";

function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code");
  // 缺 code 直接判失败（初始态而非 effect 内 setState，避免级联渲染）
  const [state, setState] = useState<CallbackState>(code ? "换会话中" : "失败");
  const [failureReason, setFailureReason] = useState<string>(
    code ? "" : "链接中缺少验证凭证，请使用邮件中的原始链接",
  );

  useEffect(() => {
    if (!code) return;
    browserClient()
      .auth.exchangeCodeForSession(code)
      .then(({ data, error }) => {
        if (error) {
          setState("失败");
          setFailureReason(error.message);
        } else if ((data as { redirectType?: string | null }).redirectType === "recovery") {
          // 密码重置链接（PKCE recovery）：换会话成功后进入新密码页（issue #26）
          // （auth-js 运行时返回 redirectType，但 AuthTokenResponse 类型未收录，故窄化断言）
          router.replace("/reset-password");
        } else {
          setState("成功");
        }
      })
      .catch(() => {
        setState("失败");
        setFailureReason("网络异常，请稍后重试");
      });
  }, [code, router]);

  return (
    <div className="卡片 入场 w-full max-w-md p-6 text-center">
      {state === "换会话中" && (
        <p className="呼吸 text-sm text-muted" data-testid="换会话中">正在完成邮箱验证…</p>
      )}
      {state === "成功" && (
        <div data-testid="验证成功">
          <h1 className="标题 mb-2 text-xl" style={{ color: "var(--色-通过)" }}>邮箱验证成功</h1>
          <p className="text-sm text-muted">账号已生效，即将开始练习之旅。</p>
          <Link className="主按钮 mt-5 inline-block px-4 py-2 text-sm" href="/">进入演练场</Link>
        </div>
      )}
      {state === "失败" && (
        <div data-testid="验证失败">
          <h1 className="标题 mb-2 text-xl" style={{ color: "var(--色-错误)" }}>邮箱验证失败</h1>
          <p className="text-sm text-muted">{failureReason || "验证链接无效或已过期"}</p>
          <p className="mt-2 text-xs text-muted">请回到注册页重新注册，或重新发送验证邮件。</p>
        </div>
      )}
    </div>
  );
}

export default function EmailVerificationCallback() {
  return (
    <Suspense fallback={<div className="卡片 w-full max-w-md p-6 text-center text-sm text-muted">加载中…</div>}>
      <CallbackContent />
    </Suspense>
  );
}
