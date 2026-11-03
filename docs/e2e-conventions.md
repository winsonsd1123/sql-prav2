# E2E 测试惯例（Playwright）

> 写或改 `e2e/` 下 spec 前读一遍。环境细节（webServer 启动、env 恒定化）以 `playwright.config.ts` 头注释为单一真理源，本文不复制。

## 定位与断言

- 元素定位用中文 `data-testid`（如 `域包行-图书馆借阅`、`后台侧边导航`）与 `getByRole("button", { name: "生成草稿" })`——界面文案本就是中文域（ADR-0006），testid 直接复用界面词汇
- 断言外部行为（URL、可见性、`aria-current` 等属性、请求载荷），不断言组件内部状态

## 登录态与权限打桩

- 全程不真连云：`e2e/helpers.ts` 的 `presetLoginState(page)` 写离线 Supabase session；管理员权限在各 spec 内 `page.route` 打桩 user_roles / role_permissions（教师角色 + 「访问后台」「域包管理」权限点）
- 需要域包资产 / 版本历史的场景复用共享桩 `createDomainPackAssetStub` / `createDomainPackVersionHistoryStub`（helpers.ts）

## console 卫生

- 每个 spec 在 `afterEach` 断言 `collectConsoleProblems` 为空：warning 及以上 console 输出即失败
- 违例的正确修法是补齐页面所需的 API 桩，不是放宽断言

## 运行

- `pnpm playwright test`——webServer 自动 build + start，勿手动起 server
- **多 worktree / 多代理并行跑必须各配独立端口**：`E2E_PORT=<口> pnpm playwright test`。默认 3311 且 `reuseExistingServer: true`，并行者会复用别人 worktree 的旧构建（不含自己新路由），产生假红（404 / 连接拒绝）
- 测试前提不依赖本机 `.env.local`：Supabase 占位与 LLM key 置空在 config 显式注入，任何环境行为恒定

## 已知 flake 登记

处置口径：全量跑失败 + 单跑通过 + 在不含改动的基点 commit 复现同样失败 → 判预存环境抖动，不阻塞合并，登记于此防重复排查。新 flake 先按此三步验证再入表。

| 用例 | 症状 | 根因 | 首次确认 |
|---|---|---|---|
| `cloud-domain-pack.spec.ts:35` 云端合法域包出现在学生端列表 | `ERR_CONNECTION_CLOSED` 进 console 卫生断言 | 真实网络瞬断 / 并行资源争抢 | 2026-11-02（#68 在基点复跑 3/4 同败证实） |
| `cloud-domain-pack.spec.ts:53` 云端非法域包不进入加载结果 | 同上（全量败、单跑过，基点 b97b8dd 全量同败） | 同上 | 2026-11-03（#85 三步口径验证） |
| `practice-config.spec.ts:118` 内置包A 配置改 7 题学生端生效 | 同上（全量败、单跑过，基点 b97b8dd 全量同败） | 同上 | 2026-11-03（#85 三步口径验证） |
| `admin-console.spec.ts:214` 无权限点直访 `/admin` 被重定向 | 时序抖动偶发失败 | 同上类 | 2026-11-02（单跑即过） |
