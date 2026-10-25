This is a [Next.js](https://nextjs.com) project bootstrapped with [`create-next-app`](https://nextjs.com/docs/api-reference/cli/create-next-app).

## MySQL 错误采样（错误保真度夹具）

判题内核的错误反馈以真实 MySQL 采样夹具为验收基准（`src/kernel/__tests__/fixtures/MySQL错误夹具.json`）。重采样需本地 MySQL 与 `mysql` 客户端：

```bash
MYSQL_USER=root MYSQL_PWD=<密码> MYSQL_HOST=localhost node scripts/采样MySQL错误.mjs
```

凭据只通过环境变量传给采样进程，绝不写入仓库。采样会在本地 MySQL 建 `playground` 库（与域包A表结构一致），对故意写错的 SQL 集采样错误码/SQLSTATE/文案/near token 并重写夹具文件。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit.

This project uses [`next/font`](https://nextjs.com/docs/app/building-your-application/optimizing) to automatically optimize and load [Geist](https://vercel.com/font), a new font family from Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.com/docs) - learn about Next.js features.
- [Learn Next.js](https://nextjs.com/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=vercel.com&utm_campaign=create-next-app-readme) from Vercel.

Check out our [Next.js deployment documentation](https://nextjs.com/docs/app/building-your-application/deploying) for more details.

## 静态导出与部署（issue #10）

本项目无任何后端：全部计算（随机建库、判题、防护）在浏览器端完成，SQL 执行跑在 Web Worker 中（`src/kernel/执行worker.ts`）。`next.config.ts` 已启用 `output: "export"`：

```bash
pnpm build   # 产出 out/，可直接静态托管
```

本地预览静态产物（静态导出后 `next start` 不可用）：

```bash
node scripts/静态服务.mjs out 3311
```

### Vercel 部署要点

- 直接导入仓库即可：Vercel 对 `output: "export"` 的 Next.js 项目会自动识别 `out/` 目录并按静态站点部署，无需 Framework Preset 之外的额外配置（无 Serverless / Node 运行时）。
- 构建命令无需自定义：Vercel 侧自动执行 `pnpm install && pnpm build`，仓库不含构建产物。
- 静态资源约束：`public/sql-wasm.wasm`（sql.js 引擎）与 Turbopack 产物中的 Worker 脚本（`_next/static/chunks/turbopack-worker-*.js`）均为静态文件，Vercel 默认静态服务即可（`.wasm` 的 MIME 由 Vercel 自动处理）。
- 无需环境变量；进度与种子存于浏览器 localStorage / URL，无任何后端状态。
- 注意：`cacheComponents`/PPR 与静态导出不兼容，故未启用（Next.js 16 的 `output: "export"` 会在 build 时校验并报错）。
