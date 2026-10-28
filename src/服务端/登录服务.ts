// 登录服务（服务端）：统一后端登录路由的业务编排（spec #22「登录统一后端路由」）。
// 依次：核验阿里票据 → 解析学号/邮箱标识 →（学号则服务端查 用户档案 得邮箱，映射不暴露给前端）
// → Supabase 密码登录 → 返回会话。验证码不通过直接拒绝，无降级路径。
// 密码错/账号不存在统一防枚举响应；未验证邮箱给明确拦截提示。
import { 解析登录标识 } from "@/lib/注册校验";
import { 服务端anon客户端, 服务端特权客户端 } from "@/lib/supabase/服务端客户端";
import { 核验阿里票据 } from "@/服务端/阿里核验";

export interface 登录输入 {
  标识: string;
  密码: string;
  验证票据: string;
}

export interface 会话载荷 {
  会话: { access_token: string; refresh_token: string; expires_in?: number; token_type?: string };
  用户: { id: string; email: string };
}

export type 登录结果 =
  | ({ 状态: "成功" } & 会话载荷)
  | { 状态: "验证码未通过" }
  | { 状态: "账号或密码不正确" } // 统一防枚举：学号不存在/邮箱不存在/密码错同一响应
  | { 状态: "邮箱未验证" }
  | { 状态: "标识无效"; 原因: string };

export type 凭据判定 = "凭据不符" | "邮箱未验证";
export type 密码登录结果 = ({ 状态: "成功" } & 会话载荷) | { 状态: 凭据判定 };

/** 可注入依赖（测试接缝）：验证码核验、学号→邮箱映射、密码登录 */
export interface 登录依赖 {
  核验验证码(票据: string): Promise<boolean>;
  按学号查邮箱(学号: string): Promise<string | null>;
  密码登录(邮箱: string, 密码: string): Promise<密码登录结果>;
}

/** Supabase signInWithPassword 错误 → 防枚举分类：仅「邮箱未验证」可区分，其余一律凭据不符 */
export function 解释凭据错误(错误: { code?: string; message?: string } | null | undefined): 凭据判定 {
  if (错误?.code === "email_not_confirmed" || /not confirmed/i.test(错误?.message ?? "")) {
    return "邮箱未验证";
  }
  return "凭据不符";
}

export const 默认登录依赖: 登录依赖 = {
  核验验证码: 核验阿里票据,

  // 学号 → 邮箱映射：service_role 身份直查用户档案（前端不可见此映射）
  按学号查邮箱: async (学号) => {
    const { data } = await 服务端特权客户端()
      .from("用户档案")
      .select("*")
      .eq("学号", 学号)
      .maybeSingle();
    return (data as { 邮箱?: string } | null)?.邮箱 ?? null;
  },

  密码登录: async (邮箱, 密码) => {
    const { data, error } = await 服务端anon客户端().auth.signInWithPassword({ email: 邮箱, password: 密码 });
    if (error) return { 状态: 解释凭据错误(error) };
    return {
      状态: "成功",
      会话: {
        access_token: data.session!.access_token,
        refresh_token: data.session!.refresh_token,
        expires_in: data.session!.expires_in,
        token_type: data.session!.token_type,
      },
      用户: { id: data.user!.id, email: data.user!.email! },
    };
  },
};

export async function 执行登录(输入: 登录输入, 依赖: 登录依赖 = 默认登录依赖): Promise<登录结果> {
  const 标识 = 解析登录标识(输入.标识);
  if (标识.类型 === "无效") return { 状态: "标识无效", 原因: 标识.原因 };

  // 验证码未通过：直接拒绝，不触达账号体系
  if (!(await 依赖.核验验证码(输入.验证票据))) return { 状态: "验证码未通过" };

  let 邮箱: string;
  if (标识.类型 === "邮箱") {
    邮箱 = 标识.值;
  } else {
    const 映射 = await 依赖.按学号查邮箱(标识.值);
    // 学号不存在：并入统一防枚举响应，不泄露账号存在与否
    if (!映射) return { 状态: "账号或密码不正确" };
    邮箱 = 映射;
  }

  const 凭据结果 = await 依赖.密码登录(邮箱, 输入.密码);
  if (凭据结果.状态 !== "成功") {
    if (凭据结果.状态 === "邮箱未验证") return { 状态: "邮箱未验证" };
    return { 状态: "账号或密码不正确" };
  }
  return 凭据结果;
}
