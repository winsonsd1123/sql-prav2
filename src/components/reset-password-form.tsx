"use client";

// 重设密码表单（客户端）：PASSWORD_RECOVERY 回换取会话后的落地表单。
// 校验复用注册密码规则（至少 8 位 + 字母与数字）；updateUser 改密成功后登出并引导回登录页。
import { useEffect, useState } from "react";
import Link from "next/link";
import { validateNewPassword } from "@/lib/registration-validation";
import { browserClient } from "@/lib/supabase/browser-client";

type PageState = "检查会话中" | "无会话" | "表单" | "提交中" | "成功" | "失败";

export default function ResetPasswordForm() {
  const [state, setState] = useState<PageState>("检查会话中");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 重置链接点进来时回调页已换取会话（PKCE recovery）；无会话说明链接无效/已过期
  useEffect(() => {
    browserClient().auth
      .getSession()
      .then(({ data }) => setState(data.session ? "表单" : "无会话"))
      .catch(() => setState("无会话"));
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateNewPassword(newPassword, confirmPassword);
    setError(validationError);
    if (validationError) return;
    setState("提交中");
    setSubmitError(null);
    try {
      const { error } = await browserClient().auth.updateUser({ password: newPassword });
      if (error) {
        setSubmitError(error.message);
        setState("表单");
        return;
      }
      // 改密成功即登出：引导用户用新密码重新登录
      await browserClient().auth.signOut();
      setState("成功");
    } catch {
      setSubmitError("网络异常，请稍后重试");
      setState("表单");
    }
  };

  if (state === "检查会话中") {
    return <div className="卡片 入场 w-full max-w-md p-6 text-center text-sm text-muted">正在验证重置链接…</div>;
  }

  if (state === "无会话") {
    return (
      <div className="卡片 入场 w-full max-w-md p-6 text-center" data-testid="重置链接无效">
        <h1 className="标题 mb-2 text-xl" style={{ color: "var(--色-错误)" }}>重置链接无效</h1>
        <p className="text-sm text-muted">重置链接无效或已过期，请重新发起忘记密码。</p>
        <Link className="主按钮 mt-5 inline-block px-4 py-2 text-sm" href="/forgot-password">重新发起</Link>
      </div>
    );
  }

  if (state === "成功") {
    return (
      <div className="卡片 入场 w-full max-w-md p-6 text-center" data-testid="重置成功">
        <h1 className="标题 mb-2 text-xl" style={{ color: "var(--色-通过)" }}>密码已重置</h1>
        <p className="text-sm text-muted">请使用新密码重新登录。</p>
        <Link className="主按钮 mt-5 inline-block px-4 py-2 text-sm" href="/login" data-testid="去登录">回到登录</Link>
      </div>
    );
  }

  return (
    <form className="卡片 入场 w-full max-w-md p-6" onSubmit={onSubmit} noValidate>
      <h1 className="标题 mb-1 text-xl">重置密码</h1>
      <p className="mb-4 text-xs text-muted">请设置新密码：至少 8 位，须同时包含字母与数字。</p>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">新密码</span>
          <input
            className={`输入框${error ? " 错误" : ""}`}
            type="password"
            value={newPassword}
            placeholder="至少 8 位，含字母与数字"
            autoComplete="new-password"
            disabled={state === "提交中"}
            onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
            data-testid="新密码输入"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">确认新密码</span>
          <input
            className={`输入框${error ? " 错误" : ""}`}
            type="password"
            value={confirmPassword}
            placeholder="再输入一次"
            autoComplete="new-password"
            disabled={state === "提交中"}
            onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
            data-testid="确认密码输入"
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-错误) 10%, transparent)", color: "var(--色-错误)" }} data-testid="密码错误">
          {error}
        </p>
      )}
      {submitError && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-错误) 10%, transparent)", color: "var(--色-错误)" }} data-testid="提交错误">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        className="主按钮 mt-5 w-full px-4 py-2 text-sm"
        disabled={state === "提交中"}
        data-testid="重置密码按钮"
      >
        {state === "提交中" ? "提交中…" : "重置密码"}
      </button>
    </form>
  );
}
