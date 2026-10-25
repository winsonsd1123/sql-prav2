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
