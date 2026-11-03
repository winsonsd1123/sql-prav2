// 知识点词表管理路由·单条（协议层，issue #79 / spec #75，ADR 0010）：解析路径 id、载荷与
// Authorization 头 → 调后台管理服务 → 映射响应。鉴权与归一全部收口在服务层（双权限点）。
// PUT    /api/admin/knowledge-areas/:id body { name, description } → 200 | 400（载荷非法/重名）| 401 | 403 | 404 | 500
// PATCH  /api/admin/knowledge-areas/:id body { active: boolean }   → 200 { active } | 400 | 401 | 403 | 404 | 500
// DELETE /api/admin/knowledge-areas/:id → 200 | 401 | 403 | 404 | 500（本票即物理删除，被引用禁删见 #83）
import {
  updateKnowledgeArea,
  deleteKnowledgeArea,
  setKnowledgeAreaActive,
  adminErrorResponse,
} from "@/server/admin-service";
import { readJsonBody, runAdminRoute } from "@/server/admin-route-helper";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { name?: unknown; description?: unknown } | null;
  return runAdminRoute(async () => {
    const result = await updateKnowledgeArea(
      id,
      { name: body?.name, description: body?.description },
      request.headers.get("authorization"),
    );
    switch (result.status) {
      case "ok":
        return Response.json({ ok: true });
      case "invalid":
        return Response.json({ error: "名称不能为空" }, { status: 400 });
      case "duplicate_name":
        return Response.json({ error: "同名知识点已存在" }, { status: 400 });
      case "not_found":
        return Response.json({ error: "知识点条目不存在" }, { status: 404 });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "error":
        return adminErrorResponse("error");
    }
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const active = (parsed.body as { active?: unknown } | null)?.active;
  return runAdminRoute(async () => {
    const result = await setKnowledgeAreaActive(id, active, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ active: result.active });
      case "invalid":
        return Response.json({ error: "载荷不合法：active 必须是布尔值" }, { status: 400 });
      case "not_found":
        return Response.json({ error: "知识点条目不存在" }, { status: 404 });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "error":
        return adminErrorResponse("error");
    }
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return runAdminRoute(async () => {
    const result = await deleteKnowledgeArea(id, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ ok: true });
      case "not_found":
        return Response.json({ error: "知识点条目不存在" }, { status: 404 });
      case "in_use":
        // 被引用条目禁止物理删除（#83 / ADR 0010 防悬挂引用）：只能停用（停用不阻断既有引用）
        return Response.json({ error: "该知识点已被域包引用，不能删除；如需收回请改用停用" }, { status: 400 });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "error":
        return adminErrorResponse("error");
    }
  });
}
