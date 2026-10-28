// 服务端 Supabase 客户端工厂（仅服务端可见）：anon 与 service_role 双身份。
// 安全边界（spec #22）：service_role 密钥仅存在于服务端环境变量（不带 NEXT_PUBLIC 前缀），
// 本模块只允许被 Route Handler / Server Component / 服务模块引用，绝不可进入浏览器包。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const 服务端鉴权参数 = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
} as const;

/** 服务端 anon 身份：以用户会话视角访问（受 RLS 约束） */
export function 服务端anon客户端(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    服务端鉴权参数,
  );
}

/** 服务端 service_role 身份：最高权限，绕过 RLS；仅用于注册校验等可信服务端逻辑 */
export function 服务端特权客户端(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    服务端鉴权参数,
  );
}
