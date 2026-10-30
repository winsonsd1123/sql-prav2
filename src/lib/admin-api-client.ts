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
