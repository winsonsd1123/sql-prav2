// 账号禁用/启用路由（协议层，spec #41 / T4）：解析路径 id、载荷与 Authorization 头 → 调后台管理服务 → 映射响应。
// 鉴权与自我保护全部收口在服务层（ADR-0007），本文件不含任何权限判定逻辑。
// PATCH /api/admin/users/:id  body { banned: boolean } → 200 { banned } | 400（载荷非法/自我保护）| 401 | 403 | 500
import { setAdminUserBan, adminErrorResponse } from "@/server/admin-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let banned: unknown;
  try {
    const body = await request.json();
    // 仅认对象载荷的 banned 字段；缺字段以 undefined 下发由业务层判非法
    banned = (body as { banned?: unknown } | null)?.banned;
  } catch {
    return Response.json({ error: "请求载荷不合法" }, { status: 400 });
  }
  try {
    const result = await setAdminUserBan(id, banned, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ banned: result.banned });
      case "invalid_banned":
        return Response.json({ error: "载荷不合法：banned 必须是布尔值" }, { status: 400 });
      case "self_protection":
        return Response.json({ error: "不能禁用自己的账号" }, { status: 400 });
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
