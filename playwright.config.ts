import { defineConfig } from "@playwright/test";

// UI 冒烟测试：针对静态导出产物（out/，issue #10）验证关键路径（issue #9）。
// 静态导出后 next start 不可用，改用零依赖静态服务器；独立端口 3311，避免与开发服务器冲突。
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3311",
  },
  webServer: {
    command: "pnpm build && node scripts/静态服务.mjs out 3311",
    port: 3311,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
