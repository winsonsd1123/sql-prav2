// 登录路由（协议层）：解析请求 / 返回响应，业务编排集中在 src/服务端/登录服务.ts（ADR-0004 组织纪律）。
// POST { 标识, 密码, 验证票据 } →
//   200 { 登录态, 用户 } | 401 验证码未通过/防枚举统一拒绝 | 403 邮箱未验证 | 422 标识无效 | 400/500
import type { NextRequest } from "next/server";
import { 执行登录, type 登录输入 } from "@/服务端/登录服务";

function 解析载荷(原始: unknown): 登录输入 {
  const 对象 = (typeof 原始 === "object" && 原始 !== null ? 原始 : {}) as Record<string, unknown>;
  return {
    标识: String(对象.标识 ?? ""),
    密码: String(对象.密码 ?? ""),
    验证票据: String(对象.验证票据 ?? ""),
  };
}

export async function POST(request: NextRequest) {
  let 原始: unknown;
  try {
    原始 = await request.json();
  } catch {
    return Response.json({ 错误: "请求载荷不是合法 JSON" }, { status: 400 });
  }

  try {
    const 结果 = await 执行登录(解析载荷(原始));
    switch (结果.状态) {
      case "成功":
        return Response.json({ 登录态: 结果.登录态, 用户: 结果.用户 });
      case "验证码未通过":
        return Response.json({ 错误: "验证码未通过，请重试" }, { status: 401 });
      case "学号/邮箱或密码不正确":
        return Response.json({ 错误: "学号/邮箱或密码不正确" }, { status: 401 });
      case "邮箱未验证":
        return Response.json({ 错误: "邮箱尚未验证，请先查收验证邮件" }, { status: 403 });
      case "标识无效":
        return Response.json({ 错误: 结果.原因 }, { status: 422 });
    }
  } catch {
    return Response.json({ 错误: "登录服务暂不可用，请稍后重试" }, { status: 500 });
  }
}
