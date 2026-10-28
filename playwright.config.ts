import { defineConfig } from "@playwright/test";

// E2E：Next.js 全栈形态（issue #22）后 build 产出 .next/，静态导出预览服务器不可用，
// 改用 next start 提供页面与 Route Handlers；独立端口 3311，避免与开发服务器冲突。
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3311",
  },
  webServer: {
    command: "pnpm build && pnpm start -p 3311",
    port: 3311,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
