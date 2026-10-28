"use client";

// 忘记密码请求表单（客户端）：静室主题；resetPasswordForEmail（PKCE，redirectTo 指向回调页）。
// 提交后统一展示防枚举提示（邮箱是否存在不泄露，与服务端注册校验语义一致）。
import { useState } from "react";
import Link from "next/link";
import { 校验重置请求邮箱, 重置请求统一提示 } from "@/lib/注册校验";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";

export default function ForgotPasswordForm() {
  const [邮箱, 设邮箱] = useState("");
  const [邮箱错误, 设邮箱错误] = useState<string | null>(null);
  const [提交中, 设提交中] = useState(false);
  const [已提交, 设已提交] = useState(false);

  const 提交 = async (事件: React.FormEvent) => {
    事件.preventDefault();
    const 错误 = 校验重置请求邮箱(邮箱);
    设邮箱错误(错误);
    if (错误) return;
    设提交中(true);
    try {
      // PKCE 流：code verifier 带 recovery 标记存于本地，回调页据此跳转新密码页
      const { error } = await 浏览器客户端().auth.resetPasswordForEmail(邮箱.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      // 无论 error 与否都展示统一提示（防枚举：网络/服务端错误也不区分账号存在性）
      void error;
      设已提交(true);
    } catch {
      设已提交(true);
    } finally {
      设提交中(false);
    }
  };

  if (已提交) {
    return (
      <div className="卡片 入场 w-full max-w-md p-6" data-testid="重置请求已提交">
        <h1 className="标题 mb-2 text-lg">重置邮件已请求</h1>
        <p className="text-sm leading-relaxed text-muted">{重置请求统一提示}</p>
        <Link className="次按钮 mt-5 inline-block px-4 py-2 text-sm" href="/login" data-testid="返回登录">返回登录</Link>
      </div>
    );
  }

  return (
    <form className="卡片 入场 w-full max-w-md p-6" onSubmit={提交} noValidate>
      <h1 className="标题 mb-1 text-xl">忘记密码</h1>
      <p className="mb-4 text-xs text-muted">输入注册邮箱，我们将发送重置链接到该邮箱。</p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold">注册邮箱</span>
        <input
          className={`输入框${邮箱错误 ? " 错误" : ""}`}
          type="email"
          value={邮箱}
          placeholder="name@cuc.edu.cn"
          autoComplete="email"
          disabled={提交中}
          onChange={(e) => { 设邮箱(e.target.value); 设邮箱错误(null); }}
          data-testid="邮箱输入"
        />
        {邮箱错误 && (
          <span className="text-xs" style={{ color: "var(--色-错误)" }} data-testid="错误-邮箱">{邮箱错误}</span>
        )}
      </label>

      <button
        type="submit"
        className="主按钮 mt-5 w-full px-4 py-2 text-sm"
        disabled={提交中}
        data-testid="发送重置邮件按钮"
      >
        {提交中 ? "发送中…" : "发送重置邮件"}
      </button>

      <p className="mt-3 text-xs text-muted">
        想起密码了？<a className="text-ink underline underline-offset-2" href="/login">返回登录</a>
      </p>
    </form>
  );
}
