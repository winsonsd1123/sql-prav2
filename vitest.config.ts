import { defineConfig } from "vitest/config";
import path from "node:path";
import { readFileSync } from "node:fs";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  plugins: [
    {
      // 与 next.config.ts 中 turbopack rules 的 '*.yaml': raw 对齐
      name: "yaml-as-raw",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".yaml")) {
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))}`;
        }
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
