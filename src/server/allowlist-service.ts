// 白名单服务（服务端）：从数据库读白名单总开关与域名清单，供注册校验（服务端双保险）与注册页前端即时提示。
// 读取失败（表未建 / 网络异常）时回退到最严配置（开关关闭 + 空清单），宁可拦截不可放过。
import { serverPrivilegedClient } from "@/lib/supabase/server-client";
import { strictestAllowlist, type AllowlistConfig } from "@/lib/email-allowlist";

export { strictestAllowlist };

export async function fetchAllowlistConfig(): Promise<AllowlistConfig> {
  try {
    const client = serverPrivilegedClient();
    const [configResult, domainResult] = await Promise.all([
      client.from("email_allowlist_config").select("*").eq("singleton", true).maybeSingle(),
      client.from("email_allowlist_domains").select("*"),
    ]);
    const config = configResult.data as { allow_any_domain: boolean } | null;
    const domainRows = (domainResult.data ?? []) as { domain: string }[];
    return {
      allowAnyDomain: config?.allow_any_domain ?? false,
      domainList: domainRows.map((row) => row.domain),
    };
  } catch {
    return strictestAllowlist;
  }
}
