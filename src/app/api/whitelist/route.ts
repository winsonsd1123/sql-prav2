// 白名单路由（协议层）：GET → 当前白名单配置（总开关 + 域名清单）。
// 域名清单不是用户信息，公开给注册页做前端即时提示；服务端注册校验仍会再判一次（双保险）。
import { fetchAllowlistConfig } from "@/server/allowlist-service";

export async function GET() {
  return Response.json(await fetchAllowlistConfig());
}
