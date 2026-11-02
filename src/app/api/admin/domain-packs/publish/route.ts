// 域包确认发布路由（协议层，票 #59）：教师确认的草稿 JSON → 服务端重过闸门 → #57 写入路径落库。
// 服务端不信任前端草稿（重跑闸门），鉴权（访问后台 + 域包管理）收口在服务层（ADR-0007）。
// POST /api/admin/domain-packs/publish { pack: 域包 JSON }
//   → 200 { ok: true, packId } | 400 | 401 | 403 | 422 { ok: false, report }（闸门拒绝）| 500
import { publishDomainPack } from "@/server/domain-pack-generation-service";
import { adminErrorResponse } from "@/server/admin-service";
import { readJsonBody, runAdminRoute } from "@/server/admin-route-helper";

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const pack = (parsed.body as { pack?: unknown } | null)?.pack;
  if (typeof pack !== "object" || pack === null) {
    return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  return runAdminRoute(async () => {
    const result = await publishDomainPack({ pack }, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ ok: true, packId: result.packId });
      case "gate":
        // 422 = 载荷语义被服务端闸门拒绝（非客户端格式错误）：报告完整透传供教师端渲染
        return Response.json({ ok: false, report: result.report }, { status: 422 });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "invalid":
        return Response.json({ error: "请求体格式不正确" }, { status: 400 });
      case "error":
        return adminErrorResponse("error");
    }
  });
}
