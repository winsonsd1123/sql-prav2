This is a [Next.js](https://nextjs.com) project bootstrapped with [`create-next-app`](https://nextjs.com/docs/api-reference/cli/create-next-app).

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

## 部署（issue #22 / ADR-0004）

### 部署形态：Vercel + Node runtime

用户系统迭代（issue #22）后项目为 **Next.js 全栈形态**，不再是纯静态站点，静态托管不再适用：

- **判题仍在浏览器**：随机建库、判题、防粘贴等全部计算在浏览器端完成，SQL 执行跑在 Web Worker 中（`src/kernel/执行worker.ts`）。
- **后端仅承担认证与数据**：Route Handlers（`app/api/`）+ Supabase（Auth、数据库）；登录统一走 `/api/auth/登录` 等服务端路由，进度按（用户、种子、域包）节流上云。
- `next.config.ts` 已移除 `output: "export"`；Vercel 直接导入仓库、按默认 Next.js Framework Preset 部署即可（Serverless Node runtime），构建命令与环境变量见下。

### 环境变量（六键）

以 `.env.example` 为模板（本地复制为 `.env.local`；Vercel 在 Project Settings → Environment Variables 配置同名变量）：

| 变量 | 可见性 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 公开 | Supabase 项目 URL（Dashboard → Settings → API） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 公开 | anon/publishable key（公开设计，配合 RLS） |
| `SUPABASE_SERVICE_ROLE_KEY` | **仅服务端** | 最高权限，绝不可带 `NEXT_PUBLIC_` 前缀 |
| `NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_CODE` | 公开 | 阿里云验证码 2.0 场景码（前端组件初始化） |
| `ALIYUN_CAPTCHA_ACCESS_KEY_ID` | **仅服务端** | RAM 子账号 AccessKey（仅验证码核验权限） |
| `ALIYUN_CAPTCHA_ACCESS_KEY_SECRET` | **仅服务端** | 同上 |

### Supabase 初始化

1. 创建 Supabase 项目（区域建议东京/新加坡，贴近主要用户降低延迟）。
2. SQL Editor 按时间戳顺序执行 `supabase/migrations/` 三个迁移文件：
   `20261028000001_用户档案与邮箱白名单.sql` → `20261028000002_角色与权限点.sql` → `20261028000003_练习进度.sql`（含 RLS 兜底、角色/权限点种子、白名单初始值）。
3. Auth 设置：
   - Authentication → Providers → Email：**Confirm email 开启**（未验证不能登录）。
   - Authentication → URL Configuration：Site URL 设为部署域名；Redirect URLs 加入 `https://<部署域>/auth/callback`（以及本地 `http://localhost:3000/**`）。
4. SMTP 提醒：第一版用 Supabase 内置邮件服务，**配额仅 2 封/小时**，正式上线前须在 Authentication → Emails 切换自定义 SMTP（已记上线待办，见下方清单）。

### 阿里云验证码 2.0

1. 开通验证码 2.0 实例，在控制台拿到**场景码**（SceneCode）→ `NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_CODE`。
2. 创建 **RAM 子账号**并仅授予验证码核验相关权限，生成 AccessKey → `ALIYUN_CAPTCHA_ACCESS_KEY_ID/SECRET`（服务端核验票据用；验证码不通过直接拒绝登录，无降级路径）。

### 本地开发

```bash
cp .env.example .env.local   # 填入六键真实值
pnpm install
pnpm dev
```

## 上线前检查清单

- [ ] **迁移已执行**：云端 Supabase SQL Editor 按时间戳序跑完三个迁移文件，表结构与本地一致。
- [ ] **Auth 设置**：Confirm email 已开启；Site URL / Redirect URLs 已含部署域与 `/auth/callback`。
- [ ] **SMTP**：已切换自定义 SMTP（内置邮件服务仅 2 封/小时，不够验证邮件 + 重置邮件用量）。
- [ ] **白名单开关初始值**：`邮箱白名单配置` 表种子为「放开任意域名 = false（仅白名单域名可注册）」，域名清单初始仅 `cuc.edu.cn`；如需调整直接改表（第一版无管理 UI）。
- [ ] **密码策略确认**：Supabase Auth 密码最低 8 位 + 内置强度校验（注册/重置均生效）。
- [ ] **调试期测试账号清理**：删除调试冒烟注册的测试账号（如 `dbg@cuc.edu.cn`，Supabase Dashboard → Authentication → Users 可删，同时清理 `用户档案` 关联行）。
- [ ] **角色分配**：第一版无管理界面，助教/教师角色在 Studio 直接改 `用户-角色` 表（挂「随时查看参考答案」权限点见 `角色-权限` 表与 ADR-0005）。
