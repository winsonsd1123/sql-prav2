// 浏览器端 Supabase 客户端（anon 身份，PKCE 流）：供注册/回调等客户端组件使用。
// 单例：避免重复创建导致的多套会话监听。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let singleton: SupabaseClient | null = null;

export function browserClient(): SupabaseClient {
  if (!singleton) {
    singleton = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          flowType: "pkce", // PKCE 邮箱验证流（笔记：PKCE 流在 autoconfirm 开启时不可用）
          // 回调页手动 exchangeCodeForSession 以呈现成功/失败态，关掉自动检测避免双触发
          detectSessionInUrl: false,
          // 固定存储键（默认含项目 ref，会随环境漂移）；PKCE code verifier 也存于此键下
          storageKey: "演练场-supabase-auth",
        },
      },
    );
  }
  return singleton;
}
