// 薄 LLM provider 抽象（票 #59 / spec #53 目标②，ADR-0008）：
// 业务侧只依赖 LlmProvider 接口，换模型/厂商只改配置或新增一个 create*Provider，不改业务代码。
// 首家实现 DeepSeek（OpenAI 兼容 chat/completions 协议 + json_object 输出模式）。
// API key 只存服务端环境变量（DEEPSEEK_API_KEY，绝不可带 NEXT_PUBLIC_ 前缀）。
//
// 模型 id 查证：2026-11-01 对照 https://api-docs.deepseek.com/zh-cn/ ——
// 当前 Flash 档模型标识为 "deepseek-flash"（已升级为 V4.1-Flash-1017，调用方式不变）；
// base url 为 https://api.deepseek.com；JSON 输出模式 response_format={"type":"json_object"}，
// 要求 prompt 含「json」字样并给出输出格式示例（提示词侧由 domain-pack-prompt.ts 满足）。

/** 提示词对：system 承载域包契约约束，user 承载教师输入 */
export interface LlmJsonPrompt {
  system: string;
  user: string;
}

/** LLM 调用失败分类：全部为可重试错误（网络抖动 / 接口报错 / JSON 模式空回复），不静默降级 */
export type LlmErrorKind = "network" | "api" | "empty";

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

/** LLM provider 抽象：输入提示词、输出一段声称是 JSON 的文本（解析由调用方负责） */
export interface LlmProvider {
  /** 当前模型标识（日志与冒烟记录用） */
  readonly model: string;
  completeJson(prompt: LlmJsonPrompt): Promise<string>;
}

export interface DeepSeekProviderConfig {
  /** 服务端 API key（仅 env 注入） */
  apiKey: string;
  /** OpenAI 兼容端点，缺省官方 https://api.deepseek.com（可指向代理） */
  baseUrl?: string;
  /** 模型 id，缺省 deepseek-flash（查证日期见文件头） */
  model?: string;
  /** 测试接缝：注入 fetch 桩；缺省全局 fetch */
  fetchImpl?: typeof fetch;
  /** 超时毫秒数，缺省 240 秒（route maxDuration=300 内留出闸门余量） */
  timeoutMs?: number;
}

/** DeepSeek 实现：OpenAI 兼容 chat/completions + response_format json_object，非流式 */
export function createDeepSeekProvider(config: DeepSeekProviderConfig): LlmProvider {
  const baseUrl = (config.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const model = config.model ?? "deepseek-flash";
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 240_000;
  return {
    model,
    async completeJson(prompt: LlmJsonPrompt): Promise<string> {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            response_format: { type: "json_object" },
            stream: false,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // 超时/断网同归 network 类：调用方可直接给重试入口，不区分细分原因
        throw new LlmProviderError(`LLM 网络请求失败：${err instanceof Error ? err.message : String(err)}`, "network");
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new LlmProviderError(`LLM 接口返回 ${response.status}：${body.slice(0, 200)}`, "api");
      }
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      // JSON 模式偶发空回复（官方文档：无法识别为 JSON 时 content 置空但 finish_reason 仍为 stop），按可重试错误上抛
      if (typeof content !== "string" || content.trim() === "") {
        throw new LlmProviderError("LLM 返回了空回复（JSON 输出模式偶发），可重试", "empty");
      }
      return content;
    },
  };
}

/** 从环境变量解析 DeepSeek provider：未配置 key 返回 null（route 据此返回明确的「未配置」错误，不静默） */
export function resolveDeepSeekProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  return createDeepSeekProvider({ apiKey, baseUrl: env.DEEPSEEK_BASE_URL, model: env.DEEPSEEK_MODEL });
}
