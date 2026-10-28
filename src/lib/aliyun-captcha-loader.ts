"use client";

// 阿里云验证码 2.0 前端加载器：动态注入官方脚本并完成组件初始化。
// 接缝约定：window.initAliyunCaptcha 已存在时直接复用（e2e 用 addInitScript 注入 stub 即可整体替换）。
// region/prefix 仅在显式提供环境变量时设置——中国站默认端点即正确；
// 写死 region 兜底会让 SDK 拼出 undefined.captcha-open.aliyuncs.com 无效域名（2026-10 联调实证）。

export interface AliyunCaptchaConfig {
  SceneId: string;
  mode: string;
  element: string;
  button: string;
  captchaVerifyCallback: (ticket: string) => Promise<{ captchaResult: boolean; bizResult?: boolean }>;
  getInstance?: (instance: unknown) => void;
  language?: string;
  slideStyle?: { width: number; height: number };
}

declare global {
  interface Window {
    initAliyunCaptcha?: (config: AliyunCaptchaConfig) => void;
    AliyunCaptchaConfig?: { region: string; prefix?: string };
  }
}

const CAPTCHA_SCRIPT_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";

/** 动态加载阿里验证码脚本（必须动态加载、不本地缓存）；已注入的全局 initAliyunCaptcha 优先（测试接缝） */
export function initCaptcha(
  callback: AliyunCaptchaConfig["captchaVerifyCallback"],
  onReady: () => void,
  onFailure: () => void,
) {
  const apply = (inject: (config: AliyunCaptchaConfig) => void) => {
    inject({
      SceneId: process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_CODE ?? "",
      mode: "popup",
      element: "#aliyun-captcha-element",
      button: "#login-submit-button",
      language: "cn",
      slideStyle: { width: 320, height: 40 },
      captchaVerifyCallback: callback,
    });
    onReady();
  };

  if (typeof window.initAliyunCaptcha === "function") {
    apply(window.initAliyunCaptcha);
    return;
  }
  // 区域配置（国际站用法）：仅显式提供时设置，无兜底
  const region = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION;
  const prefix = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX;
  if (region || prefix) {
    window.AliyunCaptchaConfig = {
      ...(region ? { region } : {}),
      ...(prefix ? { prefix } : {}),
    } as Window["AliyunCaptchaConfig"];
  }
  const script = document.createElement("script");
  script.src = CAPTCHA_SCRIPT_URL;
  script.async = true;
  script.onload = () => {
    if (typeof window.initAliyunCaptcha === "function") apply(window.initAliyunCaptcha);
    else onFailure();
  };
  script.onerror = onFailure;
  document.head.appendChild(script);
}
