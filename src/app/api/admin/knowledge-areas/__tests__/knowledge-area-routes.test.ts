// 接缝：知识点词表管理路由（协议边界，issue #79）——mock 后台管理服务，
// 只测 HTTP 状态码、载荷映射与请求体解析。鉴权 401/403 行为在服务层单测断言，不在此重复。
import { describe, expect, it, vi, beforeEach } from "vitest";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const setActiveMock = vi.fn();

vi.mock("@/server/admin-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin-service")>()),
  listKnowledgeAreas: (...args: unknown[]) => listMock(...args),
  createKnowledgeArea: (...args: unknown[]) => createMock(...args),
  updateKnowledgeArea: (...args: unknown[]) => updateMock(...args),
  deleteKnowledgeArea: (...args: unknown[]) => deleteMock(...args),
  setKnowledgeAreaActive: (...args: unknown[]) => setActiveMock(...args),
}));

import { GET, POST } from "@/app/api/admin/knowledge-areas/route";
import { PUT, PATCH, DELETE } from "@/app/api/admin/knowledge-areas/[id]/route";

function request(url: string, init: RequestInit = {}): Request {
  return new Request(url, init) as never;
}

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  setActiveMock.mockReset();
});

describe("GET /api/admin/knowledge-areas", () => {
  it("Authorization 头原样透传业务层", async () => {
    listMock.mockResolvedValue({ status: "ok", entries: [] });
    await GET(request("http://localhost/api/admin/knowledge-areas", { headers: { authorization: "Bearer tok" } }));
    expect(listMock).toHaveBeenCalledWith("Bearer tok");
  });

  it("放行：200 返回全量条目", async () => {
    listMock.mockResolvedValue({ status: "ok", entries: [{ id: "ka-1", name: "子查询", description: "", active: true }] });
    const response = await GET(request("http://localhost/api/admin/knowledge-areas", { headers: { authorization: "Bearer t" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      entries: [{ id: "ka-1", name: "子查询", description: "", active: true }],
    });
  });

  it("鉴权失败：401 / 403；服务异常：500", async () => {
    listMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await GET(request("http://localhost/api/admin/knowledge-areas"))).status).toBe(401);
    listMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await GET(request("http://localhost/api/admin/knowledge-areas"))).status).toBe(403);
    listMock.mockResolvedValueOnce({ status: "error" });
    expect((await GET(request("http://localhost/api/admin/knowledge-areas"))).status).toBe(500);
  });
});

describe("POST /api/admin/knowledge-areas", () => {
  function postRequest(body: unknown, authorization = "Bearer t") {
    return request("http://localhost/api/admin/knowledge-areas", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("名称/描述与 Authorization 头透传业务层", async () => {
    createMock.mockResolvedValue({ status: "ok", id: "ka-9" });
    const response = await POST(postRequest({ name: "日期函数", description: "日期处理" }, "Bearer tok"));
    expect(response.status).toBe(200);
    expect(createMock).toHaveBeenCalledWith("日期函数", "日期处理", "Bearer tok");
    await expect(response.json()).resolves.toEqual({ id: "ka-9" });
  });

  it("载荷非法：400；重名冲突：400（专用文案）；鉴权 401/403；服务异常 500", async () => {
    createMock.mockResolvedValueOnce({ status: "invalid" });
    expect((await POST(postRequest({ name: "  " }))).status).toBe(400);
    createMock.mockResolvedValueOnce({ status: "duplicate_name" });
    const dup = await POST(postRequest({ name: "子查询" }));
    expect(dup.status).toBe(400);
    await expect(dup.json()).resolves.toEqual({ error: "同名知识点已存在" });
    createMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await POST(postRequest({ name: "x" }))).status).toBe(401);
    createMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await POST(postRequest({ name: "x" }))).status).toBe(403);
    createMock.mockResolvedValueOnce({ status: "error" });
    expect((await POST(postRequest({ name: "x" }))).status).toBe(500);
  });

  it("请求体非 JSON：400", async () => {
    const response = await POST(postRequest("{bad json"));
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/knowledge-areas/:id", () => {
  function putRequest(id: string, body: unknown, authorization = "Bearer t") {
    return request(`http://localhost/api/admin/knowledge-areas/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    });
  }

  it("路径 id、载荷与 Authorization 头透传业务层", async () => {
    updateMock.mockResolvedValue({ status: "ok" });
    const response = await PUT(putRequest("ka-1", { name: "改名", description: "新描述" }, "Bearer tok"), {
      params: Promise.resolve({ id: "ka-1" }),
    });
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith("ka-1", { name: "改名", description: "新描述" }, "Bearer tok");
  });

  it("invalid 400；not_found 404；duplicate_name 400；鉴权 401/403；服务异常 500", async () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    updateMock.mockResolvedValueOnce({ status: "invalid" });
    expect((await PUT(putRequest("ka-1", { name: " " }), ctx("ka-1"))).status).toBe(400);
    updateMock.mockResolvedValueOnce({ status: "not_found" });
    expect((await PUT(putRequest("ka-404", { name: "x" }), ctx("ka-404"))).status).toBe(404);
    updateMock.mockResolvedValueOnce({ status: "duplicate_name" });
    expect((await PUT(putRequest("ka-1", { name: "子查询" }), ctx("ka-1"))).status).toBe(400);
    updateMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await PUT(putRequest("ka-1", { name: "x" }), ctx("ka-1"))).status).toBe(401);
    updateMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await PUT(putRequest("ka-1", { name: "x" }), ctx("ka-1"))).status).toBe(403);
    updateMock.mockResolvedValueOnce({ status: "error" });
    expect((await PUT(putRequest("ka-1", { name: "x" }), ctx("ka-1"))).status).toBe(500);
  });
});

describe("PATCH /api/admin/knowledge-areas/:id", () => {
  function patchRequest(id: string, body: unknown) {
    return request(`http://localhost/api/admin/knowledge-areas/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: "Bearer t" },
      body: JSON.stringify(body),
    });
  }
  const ctx = { params: Promise.resolve({ id: "ka-1" }) };

  it("路径 id、active 与 Authorization 头透传业务层", async () => {
    setActiveMock.mockResolvedValue({ status: "ok", active: false });
    const response = await PATCH(patchRequest("ka-1", { active: false }), ctx);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: false });
    expect(setActiveMock).toHaveBeenCalledWith("ka-1", false, "Bearer t");
  });

  it("invalid 400；not_found 404；鉴权 401/403；服务异常 500", async () => {
    setActiveMock.mockResolvedValueOnce({ status: "invalid" });
    expect((await PATCH(patchRequest("ka-1", { active: "yes" }), ctx)).status).toBe(400);
    setActiveMock.mockResolvedValueOnce({ status: "not_found" });
    expect((await PATCH(patchRequest("ka-1", { active: true }), ctx)).status).toBe(404);
    setActiveMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await PATCH(patchRequest("ka-1", { active: true }), ctx)).status).toBe(401);
    setActiveMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await PATCH(patchRequest("ka-1", { active: true }), ctx)).status).toBe(403);
    setActiveMock.mockResolvedValueOnce({ status: "error" });
    expect((await PATCH(patchRequest("ka-1", { active: true }), ctx)).status).toBe(500);
  });
});

describe("DELETE /api/admin/knowledge-areas/:id", () => {
  const ctx = { params: Promise.resolve({ id: "ka-1" }) };

  it("路径 id 与 Authorization 头透传业务层；放行 200", async () => {
    deleteMock.mockResolvedValue({ status: "ok" });
    const response = await DELETE(
      request("http://localhost/api/admin/knowledge-areas/ka-1", {
        method: "DELETE",
        headers: { authorization: "Bearer tok" },
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith("ka-1", "Bearer tok");
  });

  it("not_found 404；鉴权 401/403；服务异常 500", async () => {
    deleteMock.mockResolvedValueOnce({ status: "not_found" });
    expect((await DELETE(request("http://x/api/admin/knowledge-areas/ka-404", { method: "DELETE" }), { params: Promise.resolve({ id: "ka-404" }) })).status).toBe(404);
    deleteMock.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await DELETE(request("http://x", { method: "DELETE" }), ctx)).status).toBe(401);
    deleteMock.mockResolvedValueOnce({ status: "forbidden" });
    expect((await DELETE(request("http://x", { method: "DELETE" }), ctx)).status).toBe(403);
    deleteMock.mockResolvedValueOnce({ status: "error" });
    expect((await DELETE(request("http://x", { method: "DELETE" }), ctx)).status).toBe(500);
  });
});
