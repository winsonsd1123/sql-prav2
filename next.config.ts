import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 静态导出（issue #10）：全部计算在浏览器端完成，无任何后端；
  // pnpm build 产出 out/，可直接静态托管（Vercel 会自动识别 out 目录）。
  output: "export",
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
