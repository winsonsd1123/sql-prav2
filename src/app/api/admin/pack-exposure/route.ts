// 域包放出清单管理路由（协议层，issue #55 / spec #53 目标③）：透传 Authorization 头 → 调后台管理服务 → 映射响应。
// 鉴权细节全部收口在服务层（ADR-0007，本路由额外要求「域包管理」权限点）；
// 全量幂等设置，空清单合法（有意配置为全不放）。
// GET /api/admin/pack-exposure → 200 { packIds } | 401 | 403 | 500
// PUT /api/admin/pack-exposure { packIds: string[] } → 200 | 400 | 401 | 403 | 500
import { getAdminPackExposure, saveAdminPackExposure, adminErrorResponse } from "@/server/admin-service";
import { readJsonBody, runAdminRoute } from "@/server/admin-route-helper";

export async function GET(request: Request) {
  return runAdminRoute(async () => {
    const result = await getAdminPackExposure(request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ packIds: result.packIds });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "error":
        return adminErrorResponse("error");
    }
  });
}

export async function PUT(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  // 请求体形状校验：packIds 必须为字符串数组（逐项合法性交业务层归一）
  const packIds = (parsed.body as { packIds?: unknown } | null)?.packIds;
  if (!Array.isArray(packIds)) return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  return runAdminRoute(async () => {
    const result = await saveAdminPackExposure(packIds, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ ok: true });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "invalid":
        return Response.json({ error: "放出清单格式不正确" }, { status: 400 });
      case "error":
        return adminErrorResponse("error");
    }
  });
}
