// 域包演练配置路由（协议层，票 #61 / spec #53 目标②）：透传 Authorization 头 → 调演练配置服务 → 映射响应。
// 鉴权与合法性校验全部收口在服务层（ADR-0007，双权限点「访问后台」+「域包管理」；
// 配置校验=总和一致、档位 "1"-"5" 非负、各档配额 ≤ 该档模板数，服务端重校验不信任前端）。
// GET /api/admin/domain-packs/practice-config → 200 { packs } | 401 | 403 | 500
// PUT /api/admin/domain-packs/practice-config { packId, practiceConfig } → 200 | 400 { error | errors } | 401 | 403 | 404 | 500
import {
  getPracticeConfigView,
  savePracticeConfig,
} from "@/server/practice-config-service";
import { adminErrorResponse } from "@/server/admin-service";

export async function GET(request: Request) {
  try {
    const result = await getPracticeConfigView(request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ packs: result.packs });
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

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  try {
    const result = await savePracticeConfig(body, request.headers.get("authorization"));
    switch (result.status) {
      case "ok":
        return Response.json({ ok: true, packId: result.packId, practiceConfig: result.practiceConfig });
      case "unauthorized":
        return adminErrorResponse("unauthorized");
      case "forbidden":
        return adminErrorResponse("forbidden");
      case "not_found":
        return Response.json({ error: "域包不存在" }, { status: 404 });
      case "invalid":
        return Response.json({ errors: result.errors }, { status: 400 });
      case "gate":
        // 422 = 载荷语义被服务端闸门拒绝（非客户端格式错误）：报告完整透传供教师端渲染（与发布路由同口径）
        return Response.json({ ok: false, report: result.report }, { status: 422 });
      case "error":
        return adminErrorResponse("error");
    }
  } catch {
    return adminErrorResponse("error");
  }
}
