// 白名单管理视图路由（协议层，spec #41 / T5）：透传 Authorization 头 → 调后台管理服务 → 映射响应。
// 鉴权细节全部收口在服务层（ADR-0007）。GET /api/admin/whitelist → 200 { allowAnyDomain, domains } | 401 | 403 | 500
import { getAdminWhitelist } from "@/server/admin-service";

export async function GET(request: Request) {
  try {
    const result = await getAdminWhitelist(request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ allowAnyDomain: result.allowAnyDomain, domains: result.domains });
      case "unauthorized":
        return Response.json({ error: "未登录或登录态已失效" }, { status: 401 });
      case "forbidden":
        return Response.json({ error: "没有访问后台的权限" }, { status: 403 });
      case "error":
        return Response.json({ error: "管理服务暂不可用，请稍后重试" }, { status: 500 });
    }
  } catch {
    return Response.json({ error: "管理服务暂不可用，请稍后重试" }, { status: 500 });
  }
}
