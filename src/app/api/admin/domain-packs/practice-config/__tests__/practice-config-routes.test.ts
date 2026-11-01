// 接缝：域包演练配置路由（协议边界，票 #61）——mock 演练配置服务，
// 只测 HTTP 状态码、载荷映射与请求体解析。鉴权 401/403 与配置校验在服务层单测断言，不在此重复。
import { describe, expect, it, vi, beforeEach } from "vitest";

const getPracticeConfigViewMock = vi.fn();
const savePracticeConfigMock = vi.fn();

vi.mock("@/server/practice-config-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/practice-config-service")>()),
  getPracticeConfigView: (...args: unknown[]) => getPracticeConfigViewMock(...args),
  savePracticeConfig: (...args: unknown[]) => savePracticeConfigMock(...args),
}));

import { GET, PUT } from "@/app/api/admin/domain-packs/practice-config/route";

function request(url: string, init: RequestInit = {}): Request {
  return new Request(url, init) as never;
}

beforeEach(() => {
  getPracticeConfigViewMock.mockReset();
  savePracticeConfigMock.mockReset();
});

describe("GET /api/admin/domain-packs/practice-config", () => {
  it("Authorization 头原样透传业务层", async () => {
    getPracticeConfigViewMock.mockResolvedValue({ status: "ok", packs: [] });
    await GET(request("http://localhost/api/admin/domain-packs/practice-config", { headers: { authorization: "Bearer tok" } }));
    expect(getPracticeConfigViewMock).toHaveBeenCalledWith("Bearer tok");
  });

  it("放行：200 返回配置视图；鉴权失败 401/403；服务异常 500", async () => {
    getPracticeConfigViewMock.mockResolvedValue({
      status: "ok",
      packs: [
        {
          packId: "student-course-grade",
          name: "学生-课程-成绩",
          practiceConfig: { totalQuestions: 10, tierDistribution: { "1": 1, "2": 3, "3": 3, "4": 2, "5": 1 } },
          tierTemplateCounts: { "1": 3, "2": 12, "3": 10, "4": 7, "5": 2 },
        },
      ],
    });
    const response = await GET(request("http://localhost/api/admin/domain-packs/practice-config", { headers: { authorization: "Bearer t" } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { packs: { packId: string }[] };
    expect(body.packs[0].packId).toBe("student-course-grade");

    getPracticeConfigViewMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await GET(request("http://localhost/api/admin/domain-packs/practice-config"))).status).toBe(401);
    getPracticeConfigViewMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await GET(request("http://localhost/api/admin/domain-packs/practice-config"))).status).toBe(403);
    getPracticeConfigViewMock.mockResolvedValueOnce({ status: "error" });
    expect((await GET(request("http://localhost/api/admin/domain-packs/practice-config"))).status).toBe(500);
  });
});

describe("PUT /api/admin/domain-packs/practice-config", () => {
  const validBody = {
    packId: "student-course-grade",
    practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } },
  };

  function putRequest(body: unknown, authorization = "Bearer t") {
    return request("http://localhost/api/admin/domain-packs/practice-config", {
      method: "PUT",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("载荷与 Authorization 头透传业务层；放行 200 回显保存后的配置", async () => {
    savePracticeConfigMock.mockResolvedValue({ status: "ok", packId: "student-course-grade", practiceConfig: validBody.practiceConfig });
    const response = await PUT(putRequest(validBody, "Bearer tok"));
    expect(response.status).toBe(200);
    expect(savePracticeConfigMock).toHaveBeenCalledWith(validBody, "Bearer tok");
    await expect(response.json()).resolves.toEqual({ ok: true, packId: "student-course-grade", practiceConfig: validBody.practiceConfig });
  });

  it("请求体不是 JSON / 不是对象：400", async () => {
    expect((await PUT(putRequest("{bad json"))).status).toBe(400);
    expect((await PUT(putRequest("不是对象"))).status).toBe(400);
  });

  it("服务层拒绝：invalid → 400 带中文错误清单；not_found → 404；鉴权 401/403；异常 500", async () => {
    savePracticeConfigMock.mockResolvedValueOnce({ status: "invalid", errors: ["practiceConfig：各档分布总和（8）必须等于总题数（7）"] });
    const invalid = await PUT(putRequest(validBody));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ errors: ["practiceConfig：各档分布总和（8）必须等于总题数（7）"] });

    savePracticeConfigMock.mockResolvedValueOnce({ status: "not_found" });
    expect((await PUT(putRequest(validBody))).status).toBe(404);
    savePracticeConfigMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await PUT(putRequest(validBody))).status).toBe(401);
    savePracticeConfigMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await PUT(putRequest(validBody))).status).toBe(403);
    savePracticeConfigMock.mockRejectedValueOnce(new Error("boom"));
    expect((await PUT(putRequest(validBody))).status).toBe(500);
  });
});
