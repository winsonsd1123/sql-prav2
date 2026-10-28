// 注册校验路由（协议层）：解析请求 / 返回响应，业务逻辑在 src/server/registration-service.ts。
// POST { studentId, realName, nickname, email, password } →
//   200 { registrable: true, errors: {} } 或 422 { registrable: false, errors: {字段: 提示} }
import type { NextRequest } from "next/server";
import { checkRegistration } from "@/server/registration-service";
import type { RegistrationForm } from "@/lib/registration-validation";

function parseForm(payload: unknown): RegistrationForm {
  const obj = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  // 逐字段收拢为字符串，非字符串/缺失一律按空串处理（校验层给出中文提示）
  return {
    studentId: String(obj.studentId ?? ""),
    realName: String(obj.realName ?? ""),
    nickname: String(obj.nickname ?? ""),
    email: String(obj.email ?? ""),
    password: String(obj.password ?? ""),
  };
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ registrable: false, errors: { email: "请求载荷不是合法 JSON" } }, { status: 400 });
  }
  try {
    const result = await checkRegistration(parseForm(payload));
    return Response.json(result, { status: result.registrable ? 200 : 422 });
  } catch {
    return Response.json({ registrable: false, errors: {} }, { status: 500 });
  }
}
