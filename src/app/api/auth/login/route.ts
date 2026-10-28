// 登录路由（协议层）：解析请求 / 返回响应，业务编排集中在 src/server/login-service.ts（ADR-0004 组织纪律）。
// POST { identifier, password, captchaTicket } →
//   200 { session, user } | 401 验证码未通过/防枚举统一拒绝 | 403 邮箱未验证 | 422 标识无效 | 400/500
import type { NextRequest } from "next/server";
import { performLogin, type LoginInput } from "@/server/login-service";

function parsePayload(raw: unknown): LoginInput {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    identifier: String(obj.identifier ?? ""),
    password: String(obj.password ?? ""),
    captchaTicket: String(obj.captchaTicket ?? ""),
  };
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "请求载荷不是合法 JSON" }, { status: 400 });
  }

  try {
    const result = await performLogin(parsePayload(raw));
    switch (result.status) {
      case "success":
        return Response.json({ session: result.session, user: result.user });
      case "captcha_failed":
        return Response.json({ error: "验证码未通过，请重试" }, { status: 401 });
      case "invalid_credentials":
        return Response.json({ error: "学号/邮箱或密码不正确" }, { status: 401 });
      case "email_unconfirmed":
        return Response.json({ error: "邮箱尚未验证，请先查收验证邮件" }, { status: 403 });
      case "invalid_identifier":
        return Response.json({ error: result.reason }, { status: 422 });
    }
  } catch {
    return Response.json({ error: "登录服务暂不可用，请稍后重试" }, { status: 500 });
  }
}
