import { defineConfig } from "@playwright/test";

// UI 冒烟测试：针对生产构建（next start）验证关键路径（issue #9）。
// 独立端口 3311，避免与开发服务器冲突。
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3311",
  },
  webServer: {
    command: "pnpm exec next start -p 3311",
    port: 3311,
    reuseExistingServer: true,
  },
});
