// 域包版本历史路由（协议层，票 #62 / ADR-0009）：按基础名查询历史版本 + 当前版本。
// GET /api/admin/domain-packs/versions?packId=基础名
//   → 200 { versions: [{ packId, versionLabel, name, createdAt, isCurrent }] } | 400 | 401 | 403 | 500
import { getDomainPackVersionHistory } from "@/server/domain-pack-refine-service";
import { adminErrorResponse } from "@/server/admin-service";

export async function GET(request: Request) {
  const packId = new URL(request.url).searchParams.get("packId");
  if (packId === null || packId.trim() === "") {
    return Response.json({ error: "缺少 packId 查询参数" }, { status: 400 });
  }
  try {
    const result = await getDomainPackVersionHistory(packId, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ versions: result.versions });
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
