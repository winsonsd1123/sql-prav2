// 登录服务（服务端）：统一后端登录路由的业务编排（spec #22「登录统一后端路由」）。
// 依次：核验阿里票据 → 解析学号/邮箱标识 →（学号则服务端查用户档案 profiles 得邮箱，映射不暴露给前端）
// → Supabase 密码登录 → 返回登录态。验证码不通过直接拒绝，无降级路径。
// 密码错/用户不存在统一防枚举响应；未验证邮箱给明确拦截提示。
import { parseLoginIdentifier } from "@/lib/registration-validation";
import { serverAnonClient, serverPrivilegedClient } from "@/lib/supabase/server-client";
import { verifyAliyunTicket } from "@/server/aliyun-captcha";

export interface LoginInput {
  identifier: string;
  password: string;
  captchaTicket: string;
}

export interface SessionPayload {
  session: { access_token: string; refresh_token: string; expires_in?: number; token_type?: string };
  user: { id: string; email: string };
}

export type LoginResult =
  | ({ status: "success" } & SessionPayload)
  | { status: "captcha_failed" }
  | { status: "invalid_credentials" } // 统一防枚举：学号不存在/邮箱不存在/密码错同一响应
  | { status: "email_unconfirmed" }
  | { status: "invalid_identifier"; reason: string };

export type CredentialVerdict = "bad_credentials" | "email_unconfirmed";
export type PasswordLoginResult = ({ status: "success" } & SessionPayload) | { status: CredentialVerdict };

/** 可注入依赖（测试接缝）：验证码核验、学号→邮箱映射、密码登录 */
export interface LoginDeps {
  verifyCaptcha(ticket: string): Promise<boolean>;
  getEmailByStudentId(studentId: string): Promise<string | null>;
  passwordLogin(email: string, password: string): Promise<PasswordLoginResult>;
}

/** Supabase signInWithPassword 错误 → 防枚举分类：仅「邮箱未验证」可区分，其余一律凭据不符 */
export function interpretCredentialError(error: { code?: string; message?: string } | null | undefined): CredentialVerdict {
  if (error?.code === "email_not_confirmed" || /not confirmed/i.test(error?.message ?? "")) {
    return "email_unconfirmed";
  }
  return "bad_credentials";
}

export const defaultLoginDeps: LoginDeps = {
  verifyCaptcha: verifyAliyunTicket,

  // 学号 → 邮箱映射：service_role 身份直查用户档案（前端不可见此映射）
  getEmailByStudentId: async (studentId) => {
    const { data } = await serverPrivilegedClient()
      .from("profiles")
      .select("*")
      .eq("student_id", studentId)
      .maybeSingle();
    return (data as { email?: string } | null)?.email ?? null;
  },

  passwordLogin: async (email, password) => {
    const { data, error } = await serverAnonClient().auth.signInWithPassword({ email, password });
    if (error) return { status: interpretCredentialError(error) };
    return {
      status: "success",
      session: {
        access_token: data.session!.access_token,
        refresh_token: data.session!.refresh_token,
        expires_in: data.session!.expires_in,
        token_type: data.session!.token_type,
      },
      user: { id: data.user!.id, email: data.user!.email! },
    };
  },
};

export async function performLogin(input: LoginInput, deps: LoginDeps = defaultLoginDeps): Promise<LoginResult> {
  const identifier = parseLoginIdentifier(input.identifier);
  if (identifier.type === "invalid") return { status: "invalid_identifier", reason: identifier.reason };

  // 验证码未通过：直接拒绝，不触达用户体系
  if (!(await deps.verifyCaptcha(input.captchaTicket))) return { status: "captcha_failed" };

  let email: string;
  if (identifier.type === "email") {
    email = identifier.value;
  } else {
    const mapped = await deps.getEmailByStudentId(identifier.value);
    // 学号不存在：并入统一防枚举响应，不泄露用户存在与否
    if (!mapped) return { status: "invalid_credentials" };
    email = mapped;
  }

  const credentialResult = await deps.passwordLogin(email, input.password);
  if (credentialResult.status !== "success") {
    if (credentialResult.status === "email_unconfirmed") return { status: "email_unconfirmed" };
    return { status: "invalid_credentials" };
  }
  return credentialResult;
}
