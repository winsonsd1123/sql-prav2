// 白名单总开关路由（协议层，spec #41 / T5）：解析请求体 → 调后台管理服务 → 映射响应。
// 鉴权细节全部收口在服务层（ADR-0007）。
// PATCH /api/admin/whitelist/config { allowAnyDomain } → 200 | 400 | 401 | 403 | 500
import { updateAdminWhitelistConfig, adminErrorResponse } from "@/server/admin-service";

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  const allowAnyDomain = (body as { allowAnyDomain?: unknown } | null)?.allowAnyDomain;
  if (typeof allowAnyDomain !== "boolean") {
    return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  try {
    const result = await updateAdminWhitelistConfig(allowAnyDomain, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ ok: true });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "invalid":
        return Response.json({ error: result.error }, { status: 400 });
      case "error":
        return adminErrorResponse("error");
    }
  } catch {
    return adminErrorResponse("error");
  }
}
