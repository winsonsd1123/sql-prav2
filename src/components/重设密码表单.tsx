"use client";

// 重设密码表单（客户端）：PASSWORD_RECOVERY 回换取会话后的落地表单。
// 校验复用注册密码规则（至少 8 位 + 字母与数字）；updateUser 改密成功后登出并引导回登录页。
import { useEffect, useState } from "react";
import Link from "next/link";
import { 校验新密码 } from "@/lib/注册校验";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";

type 页面状态 = "检查会话中" | "无会话" | "表单" | "提交中" | "成功" | "失败";

export default function ResetPasswordForm() {
  const [状态, 设状态] = useState<页面状态>("检查会话中");
  const [新密码, 设新密码] = useState("");
  const [确认密码, 设确认密码] = useState("");
  const [错误, 设错误] = useState<string | null>(null);
  const [提交错误, 设提交错误] = useState<string | null>(null);

  // 重置链接点进来时回调页已换取会话（PKCE recovery）；无会话说明链接无效/已过期
  useEffect(() => {
    浏览器客户端().auth
      .getSession()
      .then(({ data }) => 设状态(data.session ? "表单" : "无会话"))
      .catch(() => 设状态("无会话"));
  }, []);

  const 提交 = async (事件: React.FormEvent) => {
    事件.preventDefault();
    const 校验错误 = 校验新密码(新密码, 确认密码);
    设错误(校验错误);
    if (校验错误) return;
    设状态("提交中");
    设提交错误(null);
    try {
      const { error } = await 浏览器客户端().auth.updateUser({ password: 新密码 });
      if (error) {
        设提交错误(error.message);
        设状态("表单");
        return;
      }
      // 改密成功即登出：引导用户用新密码重新登录
      await 浏览器客户端().auth.signOut();
      设状态("成功");
    } catch {
      设提交错误("网络异常，请稍后重试");
      设状态("表单");
    }
  };

  if (状态 === "检查会话中") {
    return <div className="卡片 入场 w-full max-w-md p-6 text-center text-sm text-muted">正在验证重置链接…</div>;
  }

  if (状态 === "无会话") {
    return (
      <div className="卡片 入场 w-full max-w-md p-6 text-center" data-testid="重置链接无效">
        <h1 className="标题 mb-2 text-xl" style={{ color: "var(--色-错误)" }}>重置链接无效</h1>
        <p className="text-sm text-muted">重置链接无效或已过期，请重新发起忘记密码。</p>
        <Link className="主按钮 mt-5 inline-block px-4 py-2 text-sm" href="/forgot-password">重新发起</Link>
      </div>
    );
  }

  if (状态 === "成功") {
    return (
      <div className="卡片 入场 w-full max-w-md p-6 text-center" data-testid="重置成功">
        <h1 className="标题 mb-2 text-xl" style={{ color: "var(--色-通过)" }}>密码已重置</h1>
        <p className="text-sm text-muted">请使用新密码重新登录。</p>
        <Link className="主按钮 mt-5 inline-block px-4 py-2 text-sm" href="/login" data-testid="去登录">回到登录</Link>
      </div>
    );
  }

  return (
    <form className="卡片 入场 w-full max-w-md p-6" onSubmit={提交} noValidate>
      <h1 className="标题 mb-1 text-xl">重置密码</h1>
      <p className="mb-4 text-xs text-muted">请设置新密码：至少 8 位，须同时包含字母与数字。</p>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">新密码</span>
          <input
            className={`输入框${错误 ? " 错误" : ""}`}
            type="password"
            value={新密码}
            placeholder="至少 8 位，含字母与数字"
            autoComplete="new-password"
            disabled={状态 === "提交中"}
            onChange={(e) => { 设新密码(e.target.value); 设错误(null); }}
            data-testid="新密码输入"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">确认新密码</span>
          <input
            className={`输入框${错误 ? " 错误" : ""}`}
            type="password"
            value={确认密码}
            placeholder="再输入一次"
            autoComplete="new-password"
            disabled={状态 === "提交中"}
            onChange={(e) => { 设确认密码(e.target.value); 设错误(null); }}
            data-testid="确认密码输入"
          />
        </label>
      </div>

      {错误 && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-错误) 10%, transparent)", color: "var(--色-错误)" }} data-testid="密码错误">
          {错误}
        </p>
      )}
      {提交错误 && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-错误) 10%, transparent)", color: "var(--色-错误)" }} data-testid="提交错误">
          {提交错误}
        </p>
      )}

      <button
        type="submit"
        className="主按钮 mt-5 w-full px-4 py-2 text-sm"
        disabled={状态 === "提交中"}
        data-testid="重置密码按钮"
      >
        {状态 === "提交中" ? "提交中…" : "重置密码"}
      </button>
    </form>
  );
}
