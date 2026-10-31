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
  },
});
