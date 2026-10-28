// 注册表单校验（纯函数）：供注册页前端即时提示与服务端注册校验路由共用。
// 与白名单判定共用同一套规则，前端即时提示 + 服务端双保险。

import { isEmailRegisterable, type AllowlistConfig } from "@/lib/email-allowlist";

export interface RegistrationForm {
  studentId: string;
  realName: string;
  nickname: string;
  email: string;
  password: string;
}

/** 字段名 → 中文错误提示；空对象表示全部通过 */
export type RegistrationFormErrors = Partial<Record<keyof RegistrationForm, string>>;

const emailRegex = /^[^\s@]+@[^\s@]+$/;

// ── 密码强度（共用规则）：注册与重置新密码同一套判定 ──

/** 单字段密码强度校验：通过返回 null，否则返回中文错误提示 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "密码至少 8 位";
  if (!(/[a-zA-Z]/.test(password) && /\d/.test(password))) return "密码须同时包含字母与数字";
  return null;
}

/** 重置密码时的新密码表单校验（强度 + 两次一致）：通过返回 null */
export function validateNewPassword(password: string, confirmPassword: string): string | null {
  const strengthError = validatePasswordStrength(password);
  if (strengthError) return strengthError;
  if (password !== confirmPassword) return "两次输入的密码不一致";
  return null;
}

// ── 忘记密码（issue #26）：请求邮箱校验 + 防枚举统一提示 ──

/** 重置请求邮箱校验：通过返回 null；只判格式，不判白名单（找回面向已注册邮箱） */
export function validateResetEmail(email: string): string | null {
  const value = email.trim();
  if (value === "") return "邮箱必填";
  if (!emailRegex.test(value)) return "邮箱格式不正确";
  return null;
}

/** 防枚举统一提示：请求成功与否文案一致（与服务端注册校验的防枚举语义一致） */
export const RESET_REQUEST_UNIFORM_MESSAGE =
  "若该邮箱已注册，则会收到一封重置密码邮件，请查收（包括垃圾邮件文件夹）。";

export function validateRegistrationForm(
  form: RegistrationForm,
  allowlist: AllowlistConfig,
): RegistrationFormErrors {
  const errors: RegistrationFormErrors = {};

  const studentId = form.studentId.trim();
  if (studentId === "") errors.studentId = "学号必填";
  else if (!/^[a-zA-Z0-9]{4,20}$/.test(studentId)) errors.studentId = "学号须为 4-20 位字母或数字";

  if (form.realName.trim() === "") errors.realName = "姓名必填";

  const nickname = form.nickname.trim();
  if (nickname === "") errors.nickname = "昵称必填";
  else if (nickname.length > 20) errors.nickname = "昵称不能超过 20 字";

  const email = form.email.trim();
  if (!emailRegex.test(email)) errors.email = "邮箱格式不正确";
  else {
    const verdict = isEmailRegisterable(allowlist, email);
    if (!verdict.allowed) errors.email = verdict.reason ?? "邮箱不可注册";
  }

  const passwordError = validatePasswordStrength(form.password);
  if (passwordError) errors.password = passwordError;

  return errors;
}

// ── 登录标识解析（spec #22 story 7/8）：输入框一个，学号|邮箱 二分判定 ──

/** 登录标识二分结果：学号（须与注册规则一致的 4-20 位字母数字）或邮箱（须含 @ 且两侧非空） */
export type LoginIdentifier =
  | { type: "studentId"; value: string }
  | { type: "email"; value: string }
  | { type: "invalid"; reason: string };

const emailLoginRegex = /^[^\s@]+@[^\s@]+$/;

export function parseLoginIdentifier(input: string): LoginIdentifier {
  const value = input.trim();
  if (value === "") return { type: "invalid", reason: "请输入学号或邮箱" };
  if (value.includes("@")) {
    if (emailLoginRegex.test(value)) return { type: "email", value };
    return { type: "invalid", reason: "邮箱格式不正确" };
  }
  if (/^[a-zA-Z0-9]{4,20}$/.test(value)) return { type: "studentId", value };
  return { type: "invalid", reason: "学号须为 4-20 位字母或数字" };
}
