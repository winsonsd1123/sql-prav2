import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 全栈形态（issue #22 / ADR-0004）：移除静态导出，
  // Route Handlers 承担后端（Supabase 认证与数据），判题内核仍在浏览器执行。
  // serverless bundle 须携带 sql-wasm.wasm（判题内核 execute.ts 的 Node 端定位为
  // process.cwd()/public/sql-wasm.wasm）：public/ 默认由 CDN 分发、不进函数包，
  // 缺此配置部署环境闸门生成检查 WASM 加载 ENOENT（发布/微调/生成/演练配置保存共路径炸）
  outputFileTracingIncludes: {
    "/api/admin/domain-packs/**": ["./public/sql-wasm.wasm"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
