// 白名单服务（服务端）：从数据库读白名单总开关与域名清单，供注册校验（服务端双保险）与注册页前端即时提示。
// 读取失败（表未建 / 网络异常）时回退到最严配置（开关关闭 + 空清单），宁可拦截不可放过。
import { 服务端特权客户端 } from "@/lib/supabase/服务端客户端";
import { 最严白名单, type 白名单配置 } from "@/lib/白名单";

export { 最严白名单 };

export async function 读白名单配置(): Promise<白名单配置> {
  try {
    const 客户端 = 服务端特权客户端();
    // supabase select 解析器不认中文列名，统一 select("*") 后按断言取值
    const [配置结果, 域名结果] = await Promise.all([
      客户端.from("邮箱白名单配置").select("*").eq("单行锁", true).maybeSingle(),
      客户端.from("邮箱白名单域名").select("*"),
    ]);
    const 配置 = 配置结果.data as { 放开任意域名: boolean } | null;
    const 域名行 = (域名结果.data ?? []) as { 域名: string }[];
    return {
      放开任意域名: 配置?.放开任意域名 ?? false,
      域名清单: 域名行.map((行) => 行.域名),
    };
  } catch {
    return 最严白名单;
  }
}
