"use client";

// 登录表单（客户端）：静室主题；学号或邮箱 + 密码 + 阿里云验证码 2.0（每次登录必过，无降级）。
// 提交流程：点登录按钮 → 阿里组件弹验证 → captchaVerifyCallback 拿到票据 → POST /api/auth/login
// → 后端先核验票据再走用户体系；成功后浏览器客户端 setSession 恢复登录态并进入演练场。
// 验证码接缝：window.initAliyunCaptcha 已存在时直接使用（e2e 用 addInitScript 注入 stub 即可整体替换）。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseLoginIdentifier } from "@/lib/registration-validation";
import { browserClient } from "@/lib/supabase/browser-client";
import { initCaptcha } from "@/lib/aliyun-captcha-loader";

type CaptchaStatus = "初始化中" | "就绪" | "不可用";

export default function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaStatus>("初始化中");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const formRef = useRef({ identifier, password });
  // 回调只在挂载时注入一次，靠 ref 桥接读取最新表单值（在 effect 中更新，不在渲染期写 ref）
  useEffect(() => {
    formRef.current = { identifier, password };
  });

  /** 阿里组件回调：拿票据 → 调统一登录路由。返回 captchaResult 仅供组件决定是否刷新滑块 */
  async function submitLogin(ticket: string): Promise<{ captchaResult: boolean; bizResult?: boolean }> {
    const { identifier: currentIdentifier, password: currentPassword } = formRef.current;
    const parsed = parseLoginIdentifier(currentIdentifier);
    if (parsed.type === "invalid" || currentPassword === "") {
      setSubmitError(parsed.type === "invalid" ? parsed.reason : "请输入密码");
      return { captchaResult: true }; // 验证码本身已通过，仅表单未就绪
    }
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: currentIdentifier, password: currentPassword, captchaTicket: ticket }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSubmitError(payload.error ?? "登录失败，请稍后重试");
        // 验证码未通过：告知组件刷新滑块；其余错误验证码已消耗但无需刷新
        return { captchaResult: payload.error !== "验证码未通过，请重试" };
      }
      // 成功：浏览器客户端恢复登录态（PKCE 单例），再进入演练场
      await browserClient().auth.setSession({
        access_token: payload.session.access_token,
        refresh_token: payload.session.refresh_token,
      });
      router.replace("/");
      return { captchaResult: true, bizResult: true };
    } catch {
      setSubmitError("网络异常，请稍后重试");
      return { captchaResult: true };
    }
  }

  useEffect(() => {
    initCaptcha(
      submitLogin,
      () => setCaptcha("就绪"),
      () => setCaptcha("不可用"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form className="卡片 入场 w-full max-w-md p-6" noValidate>
      <h1 className="标题 mb-1 text-xl">登录</h1>
      <p className="mb-4 text-xs text-muted">用学号或注册邮箱登录；每次登录需先通过行为验证码。</p>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">学号或邮箱</span>
          <input
            className="输入框"
            type="text"
            value={identifier}
            placeholder="如 2022110001 或 name@cuc.edu.cn"
            autoComplete="username"
            onChange={(e) => { setIdentifier(e.target.value); setSubmitError(null); }}
            data-testid="标识输入"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">密码</span>
          <input
            className="输入框"
            type="password"
            value={password}
            placeholder="密码"
            autoComplete="current-password"
            onChange={(e) => { setPassword(e.target.value); setSubmitError(null); }}
            data-testid="密码输入"
          />
        </label>
      </div>

      {/* 阿里验证码挂载点（popup 模式弹层也渲染于此） */}
      <div id="aliyun-captcha-element" className="mt-3 min-h-10" />

      {captcha === "不可用" && (
        <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-警示) 10%, transparent)", color: "var(--色-警示)" }} data-testid="验证码提示">
          行为验证码加载失败，请检查网络后刷新页面重试（登录必须通过验证码，无降级路径）。
        </p>
      )}
      {captcha === "初始化中" && (
        <p className="mt-2 text-xs text-muted" data-testid="验证码提示">验证码加载中…</p>
      )}

      {submitError && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-错误) 10%, transparent)", color: "var(--色-错误)" }} data-testid="提交错误">
          {submitError}
        </p>
      )}

      {/* id 供阿里组件绑定弹层触发；验证码未就绪则禁用（无降级路径） */}
      <button
        type="button"
        id="login-submit-button"
        className="主按钮 mt-5 w-full px-4 py-2 text-sm"
        disabled={captcha !== "就绪"}
        data-testid="登录按钮"
      >
        登录
      </button>

      <p className="mt-3 flex items-baseline justify-between text-xs text-muted">
        <span>还没有账号？<a className="text-ink underline underline-offset-2" href="/register">去注册</a></span>
        <a className="text-ink underline underline-offset-2" href="/forgot-password" data-testid="忘记密码入口">忘记密码？</a>
      </p>
    </form>
  );
}
