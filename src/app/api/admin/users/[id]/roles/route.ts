// 角色全量设置路由（协议层，spec #41 / T3）：解析路径 id、载荷与 Authorization 头 → 调后台管理服务 → 映射响应。
// 鉴权与自我保护全部收口在服务层（ADR-0007），本文件不含任何权限判定逻辑。
// PUT /api/admin/users/:id/roles  body { roles: string[] } → 200 { roles } | 400（载荷/角色名非法/自我保护）| 401 | 403 | 500
import { setAdminUserRoles, adminErrorResponse } from "@/server/admin-service";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let roles: unknown;
  try {
    const body = await request.json();
    // 仅认对象载荷的 roles 字段；缺字段以 undefined 下发由业务层判非法
    roles = (body as { roles?: unknown } | null)?.roles;
  } catch {
    return Response.json({ error: "请求载荷不合法" }, { status: 400 });
  }
  try {
    const result = await setAdminUserRoles(id, roles, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ roles: result.roles });
      case "invalid_roles":
        return Response.json({ error: "角色名不合法" }, { status: 400 });
      case "self_protection":
        return Response.json({ error: "不能移除自己的后台访问权限" }, { status: 400 });
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
