// 接缝：LLM provider 抽象与 DeepSeek 实现（票 #59）——注入 fetch 桩，
// 只验证对外契约：请求形状（OpenAI 兼容 chat/completions、response_format json_object、
// system/user 双消息）与失败分类（网络/接口/空回复，均为可重试错误）。
// 真实 DeepSeek 调用不进自动化测试（见 deepseek-smoke.test.ts，有 key 才跑）。
import { describe, expect, it, vi } from "vitest";
import { createDeepSeekProvider, LlmProviderError } from "@/server/llm-provider";

/** OpenAI 兼容成功响应体 */
const okBody = { choices: [{ message: { content: '{"packId":"x"}' }, finish_reason: "stop" }] };

function mkFetchStub(handler: (input: string, init?: RequestInit) => Promise<Response>) {
  const stub = vi.fn(handler);
  return { stub, fetchImpl: stub as unknown as typeof fetch };
}

describe("createDeepSeekProvider", () => {
  it("请求形状：POST {baseUrl}/chat/completions，body 含模型 id、system/user 双消息与 json_object 输出模式", async () => {
    const fetchCtx = mkFetchStub(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    const provider = createDeepSeekProvider({ apiKey: "sk-test", baseUrl: "https://api.example.com", model: "deepseek-flash", fetchImpl: fetchCtx.fetchImpl });
    const text = await provider.completeJson({ system: "系统说明（含 json 字样）", user: "场景描述" });
    expect(text).toBe('{"packId":"x"}');
    const [input, init] = fetchCtx.stub.mock.calls[0] as [string, RequestInit];
    expect(input).toBe("https://api.example.com/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer sk-test", "content-type": "application/json" });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual([
      { role: "system", content: "系统说明（含 json 字样）" },
      { role: "user", content: "场景描述" },
    ]);
  });

  it("缺省配置回落官方 base url 与当前模型 id（deepseek-flash）", async () => {
    const fetchCtx = mkFetchStub(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    const provider = createDeepSeekProvider({ apiKey: "sk", fetchImpl: fetchCtx.fetchImpl });
    expect(provider.model).toBe("deepseek-flash");
    await provider.completeJson({ system: "s json", user: "u" });
    const [input] = fetchCtx.stub.mock.calls[0] as [string, RequestInit];
    expect(input).toBe("https://api.deepseek.com/chat/completions");
  });

  it("接口非 200：抛 LlmProviderError（api 类，含状态码与响应摘要）", async () => {
    const fetchCtx = mkFetchStub(async () => new Response(JSON.stringify({ error: { message: "Authentication Fails" } }), { status: 401 }));
    const provider = createDeepSeekProvider({ apiKey: "bad", fetchImpl: fetchCtx.fetchImpl });
    await expect(provider.completeJson({ system: "s json", user: "u" })).rejects.toMatchObject({
      kind: "api",
      message: expect.stringContaining("401"),
    });
  });

  it("网络异常：抛 LlmProviderError（network 类）", async () => {
    const fetchCtx = mkFetchStub(async () => {
      throw new Error("fetch failed");
    });
    const provider = createDeepSeekProvider({ apiKey: "sk", fetchImpl: fetchCtx.fetchImpl });
    await expect(provider.completeJson({ system: "s json", user: "u" })).rejects.toMatchObject({ kind: "network" });
  });

  it("空回复（JSON 模式偶发：content 为空串）：抛 LlmProviderError（empty 类，可重试）", async () => {
    const fetchCtx = mkFetchStub(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }));
    const provider = createDeepSeekProvider({ apiKey: "sk", fetchImpl: fetchCtx.fetchImpl });
    await expect(provider.completeJson({ system: "s json", user: "u" })).rejects.toBeInstanceOf(LlmProviderError);
    await expect(provider.completeJson({ system: "s json", user: "u" })).rejects.toMatchObject({ kind: "empty" });
  });
});
