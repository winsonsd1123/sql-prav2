// 域包版本完整内容路由（协议层，票 #86 / spec #73 子票四）：按完整版本 packId 取该版本
// 的完整资产（当前资产 / 历史资产双数据源），供版本内容视图页复用详情展示组件渲染。
// GET /api/admin/domain-packs/versions/content?packId=完整版本packId
//   → 200 { asset, versionLabel, isCurrent } | 400 | 401 | 403 | 404 | 500
import { getDomainPackVersionContent } from "@/server/domain-pack-refine-service";
import { adminErrorResponse } from "@/server/admin-service";
import { runAdminRoute } from "@/server/admin-route-helper";

export async function GET(request: Request) {
  const packId = new URL(request.url).searchParams.get("packId");
  if (packId === null || packId.trim() === "") {
    return Response.json({ error: "缺少 packId 查询参数" }, { status: 400 });
  }
  return runAdminRoute(async () => {
    const result = await getDomainPackVersionContent(packId, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ asset: result.asset, versionLabel: result.versionLabel, isCurrent: result.isCurrent });
      case "not_found":
        return Response.json({ error: "未找到该版本的域包资产" }, { status: 404 });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "error":
        return adminErrorResponse("error");
    }
  });
}
