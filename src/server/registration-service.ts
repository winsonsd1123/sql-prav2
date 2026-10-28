// 注册服务（服务端）：注册预检 = 表单校验（含白名单双保险）+ 学号唯一。
// 业务逻辑集中于此，Route Handler 只做协议层（ADR-0004 的组织纪律）。
import { serverPrivilegedClient } from "@/lib/supabase/server-client";
import { validateRegistrationForm, type RegistrationForm, type RegistrationFormErrors } from "@/lib/registration-validation";
import { fetchAllowlistConfig } from "@/server/allowlist-service";

export interface RegistrationCheckResult {
  registrable: boolean;
  errors: RegistrationFormErrors;
}

/** 学号是否已被注册（服务端特权身份直查用户档案 profiles；表级唯一约束为最终兜底） */
async function studentIdTaken(studentId: string): Promise<boolean> {
  const client = serverPrivilegedClient();
  const { data } = await client.from("profiles").select("id").eq("student_id", studentId).maybeSingle();
  return data !== null;
}

export async function checkRegistration(form: RegistrationForm): Promise<RegistrationCheckResult> {
  const allowlist = await fetchAllowlistConfig();
  const errors = validateRegistrationForm(form, allowlist);
  if (!errors.studentId) {
    // 学号格式合法才查库，避免无谓请求；查库异常视为未占用，交由表级唯一约束兜底
    try {
      if (await studentIdTaken(form.studentId.trim())) errors.studentId = "该学号已注册";
    } catch {
      /* 交由唯一约束兜底 */
    }
  }
  return { registrable: Object.keys(errors).length === 0, errors };
}
