// 域包生成路由（协议层，票 #59 / spec #53 目标②）：透传 Authorization 头与请求体 → 编排服务 → 映射响应。
// LLM 同步生成（ADR-0008：maxDuration=300 容得下 1-3 分钟生成，不做任务表轮询）；
// 鉴权（访问后台 + 域包管理）收口在服务层（ADR-0007）；LLM 失败给明确错误码与重试标记，不静默降级。
// POST /api/admin/domain-packs/generate { description, sampleSql?, tableCount? }
//   → 200 { draft, report } | 400 | 401 | 403 | 502 { code, error, retryable } | 503（未配置 key）| 500
import { generateDomainPackDraft } from "@/server/domain-pack-generation-service";
import { adminErrorResponse } from "@/server/admin-service";
import { readJsonBody, requireDeepSeekProvider, runAdminRoute } from "@/server/admin-route-helper";

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  // 请求体形状预检（描述非空字符串必填；深校验在服务层，此处只为在鉴权前给出 400）
  const description = (parsed.body as { description?: unknown } | null)?.description;
  if (typeof description !== "string" || description.trim() === "") {
    return Response.json({ error: "场景描述不能为空" }, { status: 400 });
  }
  const llm = requireDeepSeekProvider();
  if (!llm.ok) return llm.response;
  return runAdminRoute(async () => {
    const result = await generateDomainPackDraft(parsed.body, request.headers.get("authorization"), { provider: llm.provider });
    switch (result.status) {
      case "ok":
        return Response.json({ draft: result.draft, report: result.report });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "invalid":
        return Response.json({ error: "场景描述不能为空" }, { status: 400 });
      case "llm_error":
      case "llm_invalid_json":
        // 可重试错误统一 502：调用方可原样重发（ADR-0008「失败给重试入口，不静默」）
        return Response.json({ code: result.status, error: result.message, retryable: true }, { status: 502 });
    }
  });
}
