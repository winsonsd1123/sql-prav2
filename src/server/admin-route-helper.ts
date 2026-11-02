// 管理 API 路由共享骨架（code-review 修复 A / Standards #1）：/api/admin/* 各 route 重复的
// 「parse body → 503 预检 → try/catch 兜底 500」形状收口在此，与 admin-service.ts 的
// adminErrorResponse（401/403/500 文案单点）配套；业务状态到响应的映射仍归各 route。
import { resolveDeepSeekProvider } from "@/server/llm-provider";
import { adminErrorResponse } from "@/server/admin-service";

/** 请求体读取结果：ok=false 时已含可直接返回的 400 响应（格式不正确） */
export type JsonBodyResult = { ok: true; body: unknown } | { ok: false; response: Response };

/** 解析 JSON 请求体（共享 400 文案）：所有接收 body 的管理 route 复用 */
export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: Response.json({ error: "请求体格式不正确" }, { status: 400 }) };
  }
}

/** LLM provider 预检（共享 503 文案与 code）：key 未配置直接明确报错，不进入鉴权与 LLM 调用（非静默降级） */
export function requireDeepSeekProvider():
  | { ok: true; provider: NonNullable<ReturnType<typeof resolveDeepSeekProvider>> }
  | { ok: false; response: Response } {
  const provider = resolveDeepSeekProvider();
  if (provider === null) {
    return {
      ok: false,
      response: Response.json(
        { code: "llm_not_configured", error: "LLM 未配置：请在服务端设置 DEEPSEEK_API_KEY" },
        { status: 503 },
      ),
    };
  }
  return { ok: true, provider };
}

/** 路由执行骨架：统一 try/catch 兜底 500（adminErrorResponse("error")），业务分支由 fn 内映射 */
export async function runAdminRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch {
    return adminErrorResponse("error");
  }
}
