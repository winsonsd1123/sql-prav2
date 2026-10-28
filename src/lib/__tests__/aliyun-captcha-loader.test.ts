// 阿里验证码加载器单测：只测公共行为（script 注入、全局配置设置时机、既有接缝复用），
// 不测组件内部渲染。jsdom 不可用（纯 node 环境），document 以 stubGlobal 模拟。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type VoidCallback = () => void;

/** 构造可控的假 document：createElement("script") 返回可手动触发 onload/onerror 的假脚本 */
function fakeDocument() {
  const scripts: Array<{
    src: string;
    async: boolean;
    onload: VoidCallback | null;
    onerror: (() => void) | null;
    mounted: boolean;
  }> = [];
  const headNode = { appendChild: (el: unknown) => { (el as { mounted: boolean }).mounted = true; } };
  const documentStub = {
    createElement: () => {
      const script = {
        src: "",
        async: false,
        onload: null as VoidCallback | null,
        onerror: null as (() => void) | null,
        mounted: false,
      };
      scripts.push(script);
      return script;
    },
    head: headNode,
  };
  return { documentStub, scripts };
}

async function importLoader() {
  return await import("../aliyun-captcha-loader");
}

describe("阿里验证码加载器", () => {
  beforeEach(() => {
    vi.resetModules();
    // node 测试环境无 window：桥接到 globalThis（loader 在浏览器直接用 window）
    vi.stubGlobal("window", globalThis);
    delete (globalThis as Record<string, unknown>).AliyunCaptchaConfig;
    delete (globalThis as Record<string, unknown>).initAliyunCaptcha;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("无 region/prefix 环境变量时，不设置 AliyunCaptchaConfig（中国站默认端点即正确；写死兜底曾致 SDK 请求 undefined.captcha-open.aliyuncs.com）", async () => {
    const { documentStub, scripts } = fakeDocument();
    vi.stubGlobal("document", documentStub);
    vi.stubEnv("NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION", undefined as unknown as string);
    vi.stubEnv("NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX", undefined as unknown as string);
    const injectStub = vi.fn();
    const { initCaptcha } = await importLoader();

    initCaptcha(vi.fn(), vi.fn(), vi.fn());
    // 模拟脚本执行后定义全局函数，再触发 onload
    (globalThis as Record<string, unknown>).initAliyunCaptcha = injectStub;
    scripts[0].onload?.();

    expect(assertScriptMounted(scripts)).toBe(true);
    expect(injectStub).toHaveBeenCalledOnce();
    // 核心断言：全局区域配置保持未设置
    expect((globalThis as Record<string, unknown>).AliyunCaptchaConfig).toBeUndefined();
  });

  it("显式提供 region/prefix 环境变量时，设置到 AliyunCaptchaConfig（国际站用法）", async () => {
    const { documentStub } = fakeDocument();
    vi.stubGlobal("document", documentStub);
    vi.stubEnv("NEXT_PUBLIC_ALIYUN_CAPTCHA_REGION", "sg");
    vi.stubEnv("NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX", "my-prefix");
    const { initCaptcha } = await importLoader();

    initCaptcha(vi.fn(), vi.fn(), vi.fn());

    expect((globalThis as Record<string, unknown>).AliyunCaptchaConfig).toEqual({ region: "sg", prefix: "my-prefix" });
  });

  it("window.initAliyunCaptcha 已存在（e2e stub 接缝）时直接复用，不注入 script", async () => {
    const { documentStub, scripts } = fakeDocument();
    vi.stubGlobal("document", documentStub);
    const injectStub = vi.fn();
    (globalThis as Record<string, unknown>).initAliyunCaptcha = injectStub;
    const { initCaptcha } = await importLoader();

    initCaptcha(vi.fn(), vi.fn(), vi.fn());

    expect(injectStub).toHaveBeenCalledOnce();
    expect(scripts).toHaveLength(0);
  });

  it("脚本加载失败时走 onFailure，不初始化组件", async () => {
    const { documentStub, scripts } = fakeDocument();
    vi.stubGlobal("document", documentStub);
    const failFn = vi.fn();
    const { initCaptcha } = await importLoader();

    initCaptcha(vi.fn(), vi.fn(), failFn);
    scripts[0].onerror?.();

    expect(failFn).toHaveBeenCalledOnce();
    expect(assertScriptMounted(scripts)).toBe(true); // 走了注入路径而非复用路径
  });
});

function assertScriptMounted(scripts: Array<{ mounted: boolean }>): boolean {
  return scripts[0]?.mounted === true;
}
