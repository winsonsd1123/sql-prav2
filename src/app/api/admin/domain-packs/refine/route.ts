// 域包微调路由（协议层，票 #62 / ADR-0009）：透传 Authorization 头与请求体 → 编排服务 → 映射响应。
// 与生成路由（#59）同模式：LLM 同步生成 maxDuration=300；key 未配置直接 503（非静默降级）；
// LLM/解析失败统一 502 可重试；鉴权（访问后台 + 域包管理）收口在服务层（ADR-0007）。
// POST /api/admin/domain-packs/refine { packId, intent, sampleSql? }
//   → 200 { draft, report, changeClass, currentVersionLabel, nextVersionLabel }
//   | 400 | 401 | 403 | 404 | 502 { code, error, retryable } | 503（未配置 key）| 500
import { refineDomainPackDraft } from "@/server/domain-pack-refine-service";
import { adminErrorResponse } from "@/server/admin-service";
import { readJsonBody, requireDeepSeekProvider, runAdminRoute } from "@/server/admin-route-helper";

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  // 请求体形状预检（packId 与意图非空必填；深校验在服务层，此处只为在鉴权前给出 400）
  const raw = (parsed.body as { packId?: unknown; intent?: unknown } | null) ?? {};
  if (typeof raw.packId !== "string" || raw.packId.trim() === "" || typeof raw.intent !== "string" || raw.intent.trim() === "") {
    return Response.json({ error: "目标域包与修改意图不能为空" }, { status: 400 });
  }
  const llm = requireDeepSeekProvider();
  if (!llm.ok) return llm.response;
  return runAdminRoute(async () => {
    const result = await refineDomainPackDraft(parsed.body, request.headers.get("authorization"), { provider: llm.provider });
    switch (result.status) {
      case "ok":
        return Response.json({
          draft: result.draft,
          report: result.report,
          changeClass: result.changeClass,
          currentVersionLabel: result.currentVersionLabel,
          nextVersionLabel: result.nextVersionLabel,
        });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "invalid":
        return Response.json({ error: "目标域包与修改意图不能为空" }, { status: 400 });
      case "not_found":
        return Response.json({ error: "目标域包不存在" }, { status: 404 });
      case "llm_error":
      case "llm_invalid_json":
        return Response.json({ code: result.status, error: result.message, retryable: true }, { status: 502 });
    }
  });
}
