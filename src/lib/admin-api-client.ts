// 后台管理客户端请求辅助（spec #41 / ADR-0007）：
// 三个后台客户端组件（白名单管理、用户列表、后台守卫）共享的
// 「浏览器会话读取 → Bearer 请求头 → 错误文案提取」收口在此；安全边界在服务端，这里只做展示层编排。

import { browserClient } from "@/lib/supabase/browser-client";

/** 读取浏览器会话的登录态（token + 用户 id）；无会话时两者均为 null（调用方据此提示重新登录或跳登录页） */
export async function getSessionAuth(): Promise<{ token: string | null; userId: string | null }> {
  const { data } = await browserClient().auth.getSession();
  return {
    token: data.session?.access_token ?? null,
    userId: data.session?.user?.id ?? null,
  };
}

/** 组装带 Bearer token 的请求头（在既有 headers 上追加 authorization） */
export function bearerHeaders(token: string, headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, authorization: `Bearer ${token}` };
}

/** 统一错误文案提取：优先回传 error 字段，兜底通用文案 */
export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** 从已解析的响应体提取错误文案（与 readErrorMessage 同口径，供先解析 body 再归类的调用方复用） */
export function errorMessageFromBody(body: unknown, fallback: string): string {
  return typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : fallback;
}

/** 带登录态的 POST JSON（code-review 修复 B）：域包生成/微调区块重复的
 * 「读会话 → 无会话提示重登 → Bearer + JSON 请求 → 解析 body」收口在此；
 * 网络异常与解析失败统一归 ok:true + body:null，由调用方的响应归类函数兜底文案（不静默） */
export async function postAdminJson(
  path: string,
  body: unknown,
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; reason: "no-session" }> {
  const { token } = await getSessionAuth();
  if (!token) return { ok: false, reason: "no-session" };
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: bearerHeaders(token, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as unknown;
    return { ok: true, status: response.status, body: parsed };
  } catch {
    // 网络失败：status=0 + body=null，归入可重试错误（与既有组件层 catch 行为同口径）
    return { ok: true, status: 0, body: null };
  }
}
