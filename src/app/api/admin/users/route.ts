// 用户列表路由（协议层，spec #41 / T2）：解析 query 与 Authorization 头 → 调后台管理服务 → 映射响应。
// 鉴权细节全部收口在服务层（ADR-0007），本文件不含任何权限判定逻辑。
// GET /api/admin/users?q=&page= → 200 { users,total,page,pageSize } | 401 | 403 | 500
import { listAdminUsers, adminErrorResponse } from "@/server/admin-service";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const result = await listAdminUsers(
      { q: params.get("q") ?? "", page: params.get("page") ?? "" },
      request.headers.get("authorization"),
    );
    switch (result.status) {
      case "ok":
        return Response.json({ users: result.users, total: result.total, page: result.page, pageSize: result.pageSize });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "error":
        return adminErrorResponse("error");
    }
  } catch {
    return adminErrorResponse("error");
  }
}
