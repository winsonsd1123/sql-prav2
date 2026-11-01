// 域包生成路由（协议层，票 #59 / spec #53 目标②）：透传 Authorization 头与请求体 → 编排服务 → 映射响应。
// LLM 同步生成（ADR-0008：maxDuration=300 容得下 1-3 分钟生成，不做任务表轮询）；
// 鉴权（访问后台 + 域包管理）收口在服务层（ADR-0007）；LLM 失败给明确错误码与重试标记，不静默降级。
// POST /api/admin/domain-packs/generate { description, sampleSql?, tableCount? }
//   → 200 { draft, report } | 400 | 401 | 403 | 502 { code, error, retryable } | 503（未配置 key）| 500
import { generateDomainPackDraft } from "@/server/domain-pack-generation-service";
import { resolveDeepSeekProvider } from "@/server/llm-provider";
import { adminErrorResponse } from "@/server/admin-service";

export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  // 请求体形状预检（描述非空字符串必填；深校验在服务层，此处只为在鉴权前给出 400）
  const description = (body as { description?: unknown } | null)?.description;
  if (typeof description !== "string" || description.trim() === "") {
    return Response.json({ error: "场景描述不能为空" }, { status: 400 });
  }
  // key 未配置直接明确报错：不进入鉴权与 LLM 调用（503，非静默降级）
  const provider = resolveDeepSeekProvider();
  if (provider === null) {
    return Response.json({ code: "llm_not_configured", error: "LLM 未配置：请在服务端设置 DEEPSEEK_API_KEY" }, { status: 503 });
  }
  try {
    const result = await generateDomainPackDraft(body, request.headers.get("authorization"), { provider });
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
  } catch {
    return adminErrorResponse("error");
  }
}
