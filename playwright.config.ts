import { defineConfig } from "@playwright/test";

// E2E：Next.js 全栈形态（issue #22）后 build 产出 .next/，静态导出预览服务器不可用，
// 改用 next start 提供页面与 Route Handlers；独立端口 3311，避免与开发服务器冲突。
// 端口可经 E2E_PORT 覆盖：多个 worktree 并行跑 e2e 时各自用独立端口（如 3312）互不抢占。
const port = Number(process.env.E2E_PORT ?? 3311);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
  },
  webServer: {
    command: `pnpm build && pnpm start -p ${port}`,
    port,
    reuseExistingServer: true,
    timeout: 300_000,
    // e2e 全程在浏览器层拦截 Supabase REST（e2e/helpers.ts 打桩），服务端不真连；
    // 占位值只为 next build/start 的模块初始化不因缺 env 抛错——worktree 没有 .env.local 也能直接跑 e2e。
    // 显式 env 优先于 .env.local（Next 不覆盖已存在的进程变量），测试与本地真实配置天然隔离。
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://e2e-placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-placeholder-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "e2e-placeholder-service-role-key",
      // 显式置空 LLM key：generate API 的 503 用例断言「环境不注入 key」，
      // 主仓库 .env.local 携带真实 key 会被 next start 加载而破坏前提（worktree 无 .env.local 反而成立）；
      // 空串覆盖使该前提在任何环境恒定，与上面三个占位同理。
      DEEPSEEK_API_KEY: "",
    },
  },
});
