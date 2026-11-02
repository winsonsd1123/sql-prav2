// 知识点词表管理路由·集合（协议层，issue #79 / spec #75，ADR 0010）：透传 Authorization 头 →
// 调后台管理服务 → 映射响应。鉴权细节全部收口在服务层（本路由要求「访问后台 + 知识点词表管理」双权限点）。
// GET  /api/admin/knowledge-areas → 200 { entries } | 401 | 403 | 500
// POST /api/admin/knowledge-areas body { name, description } → 200 { id } | 400（载荷非法/重名）| 401 | 403 | 500
import {
  listKnowledgeAreas,
  createKnowledgeArea,
  adminErrorResponse,
} from "@/server/admin-service";
import { readJsonBody, runAdminRoute } from "@/server/admin-route-helper";

export async function GET(request: Request) {
  return runAdminRoute(async () => {
    const result = await listKnowledgeAreas(request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ entries: result.entries });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "error":
        return adminErrorResponse("error");
    }
  });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { name?: unknown; description?: unknown } | null;
  return runAdminRoute(async () => {
    const result = await createKnowledgeArea(
      body?.name,
      body?.description,
      request.headers.get("authorization"),
    );
    switch (result.status) {
      case "ok":
        return Response.json({ id: result.id });
      case "invalid":
        return Response.json({ error: "名称不能为空" }, { status: 400 });
      case "duplicate_name":
        return Response.json({ error: "同名知识点已存在" }, { status: 400 });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "error":
        return adminErrorResponse("error");
    }
  });
}
