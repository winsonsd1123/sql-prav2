"use client";

// 登录表单（客户端）：静室主题；学号或邮箱 + 密码 + 阿里云验证码 2.0（每次登录必过，无降级）。
// 提交流程：点登录按钮 → 阿里组件弹验证 → captchaVerifyCallback 拿到票据 → POST /api/auth/login
// → 后端先核验票据再走账号体系；成功后浏览器客户端 setSession 恢复会话并进入演练场。
// 验证码接缝：window.initAliyunCaptcha 已存在时直接使用（e2e 用 addInitScript 注入 stub 即可整体替换）。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { 解析登录标识 } from "@/lib/注册校验";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";

type 验证码状态 = "初始化中" | "就绪" | "不可用";

interface 阿里验证码配置 {
  SceneId: string;
  mode: string;
  element: string;
  button: string;
  captchaVerifyCallback: (票据: string) => Promise<{ captchaResult: boolean; bizResult?: boolean }>;
  getInstance?: (实例: unknown) => void;
  language?: string;
  slideStyle?: { width: number; height: number };
}

declare global {
  interface Window {
    initAliyunCaptcha?: (配置: 阿里验证码配置) => void;
    AliyunCaptchaConfig?: { region: string; prefix?: string };
  }
}

const 验证码脚本地址 = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";

/** 动态加载阿里验证码脚本（必须动态加载、不本地缓存）；已注入的全局 initAliyunCaptcha 优先（测试接缝） */
function 初始化验证码(
  回调: 阿里验证码配置["captchaVerifyCallback"],
  就绪: () => void,
  失败: () => void,
) {
  const 传入 = (注入: (配置: 阿里验证码配置) => void) => {
    注入({
      SceneId: process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_CODE ?? "",
      mode: "popup",
      element: "#aliyun-captcha-element",
      button: "#login-submit-button",
      language: "cn",
      slideStyle: { width: 320, height: 40 },
      captchaVerifyCallback: 回调,
    });
    就绪();
  };

  if (typeof window.initAliyunCaptcha === "function") {
    传入(window.initAliyunCaptcha);
    return;
  }
  // 前置全局配置（prefix 在 AliyunCaptchaConfig，不在 initAliyunCaptcha 参数里）
  const 前缀 = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX;
  window.AliyunCaptchaConfig = { region: process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION ?? "cn", ...(前缀 ? { prefix: 前缀 } : {}) };
  const 脚本 = document.createElement("script");
  脚本.src = 验证码脚本地址;
  脚本.async = true;
  脚本.onload = () => {
    if (typeof window.initAliyunCaptcha === "function") 传入(window.initAliyunCaptcha);
    else 失败();
  };
  脚本.onerror = 失败;
  document.head.appendChild(脚本);
}

export default function LoginForm() {
  const 路由 = useRouter();
  const [标识, 设标识] = useState("");
  const [密码, 设密码] = useState("");
  const [验证码, 设验证码] = useState<验证码状态>("初始化中");
  const [提交错误, 设提交错误] = useState<string | null>(null);
  const 表单引用 = useRef({ 标识, 密码 });
  // 回调只在挂载时注入一次，靠 ref 桥接读取最新表单值（在 effect 中更新，不在渲染期写 ref）
  useEffect(() => {
    表单引用.current = { 标识, 密码 };
  });

  /** 阿里组件回调：拿票据 → 调统一登录路由。返回 captchaResult 仅供组件决定是否刷新滑块 */
  async function 提交登录(票据: string): Promise<{ captchaResult: boolean; bizResult?: boolean }> {
    const { 标识: 当前标识, 密码: 当前密码 } = 表单引用.current;
    const 解析 = 解析登录标识(当前标识);
    if (解析.类型 === "无效" || 当前密码 === "") {
      设提交错误(解析.类型 === "无效" ? 解析.原因 : "请输入密码");
      return { captchaResult: true }; // 验证码本身已通过，仅表单未就绪
    }
    try {
      const 响应 = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ 标识: 当前标识, 密码: 当前密码, 验证票据: 票据 }),
      });
      const 载荷 = await 响应.json();
      if (!响应.ok) {
        设提交错误(载荷.错误 ?? "登录失败，请稍后重试");
        // 验证码未通过：告知组件刷新滑块；其余错误验证码已消耗但无需刷新
        return { captchaResult: 载荷.错误 !== "验证码未通过，请重试" };
      }
      // 成功：浏览器客户端恢复会话（PKCE 单例），再进入演练场
      // 成功：浏览器客户端恢复会话（PKCE 单例），再进入演练场
      await 浏览器客户端().auth.setSession({
        access_token: 载荷.会话.access_token,
        refresh_token: 载荷.会话.refresh_token,
      });
      路由.replace("/");
      return { captchaResult: true, bizResult: true };
    } catch {
      设提交错误("网络异常，请稍后重试");
      return { captchaResult: true };
    }
  }

  useEffect(() => {
    初始化验证码(
      提交登录,
      () => 设验证码("就绪"),
      () => 设验证码("不可用"),
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
            value={标识}
            placeholder="如 2022110001 或 name@cuc.edu.cn"
            autoComplete="username"
            onChange={(e) => { 设标识(e.target.value); 设提交错误(null); }}
            data-testid="标识输入"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">密码</span>
          <input
            className="输入框"
            type="password"
            value={密码}
            placeholder="密码"
            autoComplete="current-password"
            onChange={(e) => { 设密码(e.target.value); 设提交错误(null); }}
            data-testid="密码输入"
          />
        </label>
      </div>

      {/* 阿里验证码挂载点（popup 模式弹层也渲染于此） */}
      <div id="aliyun-captcha-element" className="mt-3 min-h-10" />

      {验证码 === "不可用" && (
        <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-警示) 10%, transparent)", color: "var(--色-警示)" }} data-testid="验证码提示">
          行为验证码加载失败，请检查网络后刷新页面重试（登录必须通过验证码，无降级路径）。
        </p>
      )}
      {验证码 === "初始化中" && (
        <p className="mt-2 text-xs text-muted" data-testid="验证码提示">验证码加载中…</p>
      )}

      {提交错误 && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-错误) 10%, transparent)", color: "var(--色-错误)" }} data-testid="提交错误">
          {提交错误}
        </p>
      )}

      {/* id 供阿里组件绑定弹层触发；验证码未就绪则禁用（无降级路径） */}
      <button
        type="button"
        id="login-submit-button"
        className="主按钮 mt-5 w-full px-4 py-2 text-sm"
        disabled={验证码 !== "就绪"}
        data-testid="登录按钮"
      >
        登录
      </button>

      <p className="mt-3 text-xs text-muted">
        还没有账号？<a className="text-ink underline underline-offset-2" href="/register">去注册</a>
      </p>
    </form>
  );
}
