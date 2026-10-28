"use client";

// 忘记密码请求表单（客户端）：静室主题；resetPasswordForEmail（PKCE，redirectTo 指向回调页）。
// 提交后统一展示防枚举提示（邮箱是否存在不泄露，与服务端注册校验语义一致）。
import { useState } from "react";
import Link from "next/link";
import { validateResetEmail, RESET_REQUEST_UNIFORM_MESSAGE } from "@/lib/registration-validation";
import { browserClient } from "@/lib/supabase/browser-client";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateResetEmail(email);
    setEmailError(error);
    if (error) return;
    setSubmitting(true);
    try {
      // PKCE 流：code verifier 带 recovery 标记存于本地，回调页据此跳转新密码页
      const { error } = await browserClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      // 无论 error 与否都展示统一提示（防枚举：网络/服务端错误也不区分用户存在性）
      void error;
      setSubmitted(true);
    } catch {
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="卡片 入场 w-full max-w-md p-6" data-testid="重置请求已提交">
        <h1 className="标题 mb-2 text-lg">重置邮件已请求</h1>
        <p className="text-sm leading-relaxed text-muted">{RESET_REQUEST_UNIFORM_MESSAGE}</p>
        <Link className="次按钮 mt-5 inline-block px-4 py-2 text-sm" href="/login" data-testid="返回登录">返回登录</Link>
      </div>
    );
  }

  return (
    <form className="卡片 入场 w-full max-w-md p-6" onSubmit={onSubmit} noValidate>
      <h1 className="标题 mb-1 text-xl">忘记密码</h1>
      <p className="mb-4 text-xs text-muted">输入注册邮箱，我们将发送重置链接到该邮箱。</p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold">注册邮箱</span>
        <input
          className={`输入框${emailError ? " 错误" : ""}`}
          type="email"
          value={email}
          placeholder="name@cuc.edu.cn"
          autoComplete="email"
          disabled={submitting}
          onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
          data-testid="邮箱输入"
        />
        {emailError && (
          <span className="text-xs" style={{ color: "var(--色-错误)" }} data-testid="错误-邮箱">{emailError}</span>
        )}
      </label>

      <button
        type="submit"
        className="主按钮 mt-5 w-full px-4 py-2 text-sm"
        disabled={submitting}
        data-testid="发送重置邮件按钮"
      >
        {submitting ? "发送中…" : "发送重置邮件"}
      </button>

      <p className="mt-3 text-xs text-muted">
        想起密码了？<a className="text-ink underline underline-offset-2" href="/login">返回登录</a>
      </p>
    </form>
  );
}
