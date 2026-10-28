// 注册校验路由（协议层）：解析请求 / 返回响应，业务逻辑在 src/服务端/注册服务.ts。
// POST { 学号, 姓名, 昵称, 邮箱, 密码 } → 200 { 可注册: true, 错误: {} } 或 422 { 可注册: false, 错误: {字段: 提示} }
import type { NextRequest } from "next/server";
import { 注册预检 } from "@/服务端/注册服务";
import type { 注册表单 } from "@/lib/注册校验";

function 解析表单(载荷: unknown): 注册表单 {
  const 对象 = (typeof 载荷 === "object" && 载荷 !== null ? 载荷 : {}) as Record<string, unknown>;
  // 逐字段收拢为字符串，非字符串/缺失一律按空串处理（校验层给出中文提示）
  return {
    学号: String(对象.学号 ?? ""),
    姓名: String(对象.姓名 ?? ""),
    昵称: String(对象.昵称 ?? ""),
    邮箱: String(对象.邮箱 ?? ""),
    密码: String(对象.密码 ?? ""),
  };
}

export async function POST(request: NextRequest) {
  let 载荷: unknown;
  try {
    载荷 = await request.json();
  } catch {
    return Response.json({ 可注册: false, 错误: { 邮箱: "请求载荷不是合法 JSON" } }, { status: 400 });
  }
  try {
    const 结果 = await 注册预检(解析表单(载荷));
    return Response.json(结果, { status: 结果.可注册 ? 200 : 422 });
  } catch {
    return Response.json({ 可注册: false, 错误: {} }, { status: 500 });
  }
}
