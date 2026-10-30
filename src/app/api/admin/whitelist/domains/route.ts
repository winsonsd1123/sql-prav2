// 白名单域名清单全量保存路由（协议层，spec #41 / T5）：解析请求体 → 调后台管理服务 → 映射响应。
// 鉴权细节全部收口在服务层（ADR-0007）；幂等全量设置，空清单合法（全关时无人可注册）。
// PUT /api/admin/whitelist/domains { domains: [{ domain, note? }] } → 200 | 400 | 401 | 403 | 500
import { saveAdminWhitelistDomains } from "@/server/admin-service";

/** 请求体形状校验：domains 数组且每条含非空 domain 字符串；note 可选字符串 */
function parseDomainsBody(body: unknown): { domain: string; note?: string | null }[] | null {
  if (typeof body !== "object" || body === null) return null;
  const domains = (body as { domains?: unknown }).domains;
  if (!Array.isArray(domains)) return null;
  const parsed: { domain: string; note?: string | null }[] = [];
  for (const entry of domains) {
    if (typeof entry !== "object" || entry === null) return null;
    const { domain, note } = entry as { domain?: unknown; note?: unknown };
    if (typeof domain !== "string" || domain === "") return null;
    if (note !== undefined && note !== null && typeof note !== "string") return null;
    parsed.push({ domain, note: (note as string | undefined | null) ?? undefined });
  }
  return parsed;
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  const domains = parseDomainsBody(body);
  if (domains === null) return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  try {
    const result = await saveAdminWhitelistDomains(domains, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ ok: true });
      case "unauthorized":
        return Response.json({ error: "未登录或登录态已失效" }, { status: 401 });
      case "forbidden":
        return Response.json({ error: "没有访问后台的权限" }, { status: 403 });
      case "invalid":
        return Response.json({ error: result.error }, { status: 400 });
      case "error":
        return Response.json({ error: "管理服务暂不可用，请稍后重试" }, { status: 500 });
    }
  } catch {
    return Response.json({ error: "管理服务暂不可用，请稍后重试" }, { status: 500 });
  }
}
