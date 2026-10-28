// 注册表单校验（纯函数）：供注册页前端即时提示与服务端注册校验路由共用。
// 与白名单判定共用同一套规则，前端即时提示 + 服务端双保险。

import { 判定邮箱可注册, type 白名单配置 } from "@/lib/白名单";

export interface 注册表单 {
  学号: string;
  姓名: string;
  昵称: string;
  邮箱: string;
  密码: string;
}

/** 字段名 → 中文错误提示；空对象表示全部通过 */
export type 注册表单错误 = Partial<Record<keyof 注册表单, string>>;

const 邮箱正则 = /^[^\s@]+@[^\s@]+$/;

// ── 密码强度（共用规则）：注册与重置新密码同一套判定 ──

/** 单字段密码强度校验：通过返回 null，否则返回中文错误提示 */
export function 校验密码强度(密码: string): string | null {
  if (密码.length < 8) return "密码至少 8 位";
  if (!(/[a-zA-Z]/.test(密码) && /\d/.test(密码))) return "密码须同时包含字母与数字";
  return null;
}

/** 重置密码时的新密码表单校验（强度 + 两次一致）：通过返回 null */
export function 校验新密码(密码: string, 确认密码: string): string | null {
  const 强度错误 = 校验密码强度(密码);
  if (强度错误) return 强度错误;
  if (密码 !== 确认密码) return "两次输入的密码不一致";
  return null;
}

// ── 忘记密码（issue #26）：请求邮箱校验 + 防枚举统一提示 ──

/** 重置请求邮箱校验：通过返回 null；只判格式，不判白名单（找回面向已注册邮箱） */
export function 校验重置请求邮箱(邮箱: string): string | null {
  const 值 = 邮箱.trim();
  if (值 === "") return "邮箱必填";
  if (!邮箱正则.test(值)) return "邮箱格式不正确";
  return null;
}

/** 防枚举统一提示：请求成功与否文案一致（与服务端注册校验的防枚举语义一致） */
export const 重置请求统一提示 = "若该邮箱已注册，则会收到一封重置密码邮件，请查收（包括垃圾邮件文件夹）。";

export function 校验注册表单(表单: 注册表单, 白名单: 白名单配置): 注册表单错误 {
  const 错误: 注册表单错误 = {};

  const 学号 = 表单.学号.trim();
  if (学号 === "") 错误.学号 = "学号必填";
  else if (!/^[a-zA-Z0-9]{4,20}$/.test(学号)) 错误.学号 = "学号须为 4-20 位字母或数字";

  if (表单.姓名.trim() === "") 错误.姓名 = "姓名必填";

  const 昵称 = 表单.昵称.trim();
  if (昵称 === "") 错误.昵称 = "昵称必填";
  else if (昵称.length > 20) 错误.昵称 = "昵称不能超过 20 字";

  const 邮箱 = 表单.邮箱.trim();
  if (!邮箱正则.test(邮箱)) 错误.邮箱 = "邮箱格式不正确";
  else {
    const 判定 = 判定邮箱可注册(白名单, 邮箱);
    if (!判定.允许) 错误.邮箱 = 判定.原因 ?? "邮箱不可注册";
  }

  const 密码错误 = 校验密码强度(表单.密码);
  if (密码错误) 错误.密码 = 密码错误;

  return 错误;
}

// ── 登录标识解析（spec #22 story 7/8）：输入框一个，学号|邮箱 二分判定 ──

/** 登录标识二分结果：学号（须与注册规则一致的 4-20 位字母数字）或邮箱（须含 @ 且两侧非空） */
export type 登录标识 =
  | { 类型: "学号"; 值: string }
  | { 类型: "邮箱"; 值: string }
  | { 类型: "无效"; 原因: string };

const 邮箱登录正则 = /^[^\s@]+@[^\s@]+$/;

export function 解析登录标识(输入: string): 登录标识 {
  const 值 = 输入.trim();
  if (值 === "") return { 类型: "无效", 原因: "请输入学号或邮箱" };
  if (值.includes("@")) {
    if (邮箱登录正则.test(值)) return { 类型: "邮箱", 值 };
    return { 类型: "无效", 原因: "邮箱格式不正确" };
  }
  if (/^[a-zA-Z0-9]{4,20}$/.test(值)) return { 类型: "学号", 值 };
  return { 类型: "无效", 原因: "学号须为 4-20 位字母或数字" };
}
