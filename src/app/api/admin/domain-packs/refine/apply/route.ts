// 域包微调确认生效路由（协议层，票 #62 / ADR-0009）：教师确认的草稿 → 服务端重过闸门 +
// 重判分类（不信任前端）→ A 类即时生效 / B 类产生新版本。
// POST /api/admin/domain-packs/refine/apply { packId, pack }
//   → 200 { ok, packId, changeClass, versionLabel } | 400 | 401 | 403 | 404
//   | 409 { code: base_name_changed | no_change } | 422 { ok:false, report }（闸门拒绝）| 500
import { applyDomainPackRefinement } from "@/server/domain-pack-refine-service";
import { adminErrorResponse } from "@/server/admin-service";
import { readJsonBody, runAdminRoute } from "@/server/admin-route-helper";

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const raw = (parsed.body as { packId?: unknown; pack?: unknown } | null) ?? {};
  if (typeof raw.packId !== "string" || raw.packId.trim() === "" || typeof raw.pack !== "object" || raw.pack === null) {
    return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  return runAdminRoute(async () => {
    const result = await applyDomainPackRefinement(parsed.body, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ ok: true, packId: result.packId, changeClass: result.changeClass, versionLabel: result.versionLabel });
      case "gate":
        // 422 = 载荷语义被服务端闸门拒绝：报告完整透传供教师端渲染
        return Response.json({ ok: false, report: result.report }, { status: 422 });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "invalid":
        return Response.json({ error: "请求体格式不正确" }, { status: 400 });
      case "not_found":
        return Response.json({ error: "目标域包不存在" }, { status: 404 });
      case "base_name_changed":
        // 409 = 与目标域包当前状态冲突（基础名不可改，ADR-0009；草稿与当前无差异）
        return Response.json({ code: "base_name_changed", error: `packId 基础名不可修改（草稿为 ${result.actualBasePackId}）` }, { status: 409 });
      case "no_change":
        return Response.json({ code: "no_change", error: "草稿与当前域包没有差异，无需确认生效" }, { status: 409 });
      case "error":
        return adminErrorResponse("error");
    }
  });
}
