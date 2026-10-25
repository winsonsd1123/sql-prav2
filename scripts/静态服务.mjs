#!/usr/bin/env node
/**
 * 静态导出产物服务器（issue #10）：为 e2e 与本地预览提供 out/ 目录的静态服务。
 * 用法：node scripts/静态服务.mjs [目录=out] [端口=3311]
 * 静态导出后 next start 不再可用，故用零依赖 Node 服务器替代；
 * 带 MIME（含 .wasm application/wasm）与目录索引回退（/ → index.html）。
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const 目录 = normalize(process.argv[2] ?? "out");
const 端口 = Number(process.argv[3] ?? 3311);
if (!existsSync(目录)) {
  console.error(`目录不存在：${目录}（先执行 pnpm build）`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

createServer((req, res) => {
  const 路径 = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  let 文件 = join(目录, 路径);
  if (!existsSync(文件) || statSync(文件).isDirectory()) {
    文件 = join(目录, 路径.endsWith("/") ? `${路径}index.html` : `${路径}.html`);
  }
  if (!existsSync(文件) || statSync(文件).isDirectory()) 文件 = join(目录, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(文件)] ?? "application/octet-stream" });
  createReadStream(文件).pipe(res);
}).listen(端口, () => {
  console.log(`静态服务已启动：http://localhost:${端口}（目录 ${目录}）`);
});
