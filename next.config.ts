import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 全栈形态（issue #22 / ADR-0004）：移除静态导出，
  // Route Handlers 承担后端（Supabase 认证与数据），判题内核仍在浏览器执行。
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
      "*.yaml": {
        type: "raw",
      },
    },
  },
};

export default nextConfig;
