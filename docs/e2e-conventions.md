# E2E 测试惯例（Playwright）

> 写或改 `e2e/` 下 spec 前读一遍。环境细节（webServer 启动、env 恒定化）以 `playwright.config.ts` 头注释为单一真理源，本文不复制。

## 定位与断言

- 元素定位用中文 `data-testid`（如 `域包行-图书馆借阅`、`后台侧边导航`）与 `getByRole("button", { name: "生成草稿" })`——界面文案本就是中文域（ADR-0006），testid 直接复用界面词汇
- 断言外部行为（URL、可见性、`aria-current` 等属性、请求载荷），不断言组件内部状态
- **自定义控件的键盘用例，按键序列之间必须有同步断言**（等中间态落定，如高亮项移动到位）再发下一键——背靠背 `keyboard.press` 会抢跑：#97 实测 ArrowDown 后直接 Enter 选中了初始高亮的占位项（`data-highlighted` 断言隐式承担同步职责，删掉即红）

## 登录态与权限打桩

- 全程不真连云：`e2e/helpers.ts` 的 `presetLoginState(page)` 写离线 Supabase session；管理员权限在各 spec 内 `page.route` 打桩 user_roles / role_permissions（教师角色 + 「访问后台」「域包管理」权限点）
- 需要域包资产 / 版本历史的场景复用共享桩 `createDomainPackAssetStub` / `createDomainPackVersionHistoryStub`（helpers.ts）
- 进入学生端演练场的 spec 在 beforeEach 挂 `stubPlaygroundBackend(page)`（进度、资产、版本历史、放出清单、角色五表空桩），用例级桩其后注册覆盖；后台类 spec 中途进学生端、已自桩其余表的，至少补挂 `createCloudProgressStub`。漏任一张即真连占位主机，全量下偶发 `ERR_CONNECTION_CLOSED` 假红（#98 根治）

## console 卫生

- 每个 spec 在 `afterEach` 断言 `collectConsoleProblems` 为空：warning 及以上 console 输出即失败
- 违例的正确修法是补齐页面所需的 API 桩，不是放宽断言
- 断言统一走 `helpers.ts` 的 `expectConsoleClean(problems, exemptions?)`；豁免仅限「用例刻意桩失败响应、浏览器对 4xx/5xx 打的资源加载报错」这类无法补桩消除的预期噪声，且**必须收窄到桩失败资源的用例内传参**（用例置位标记、afterEach 按标记传入），文件级豁免会让同文件其他用例的违例逃逸（#96 验收补丁立此口径）

## 运行

- `pnpm playwright test`——webServer 自动 build + start，勿手动起 server
- **多 worktree / 多代理并行跑必须各配独立端口**：`E2E_PORT=<口> pnpm playwright test`。默认 3311 且 `reuseExistingServer: true`，并行者会复用别人 worktree 的旧构建（不含自己新路由），产生假红（404 / 连接拒绝）
- 测试前提不依赖本机 `.env.local`：Supabase 占位与 LLM key 置空在 config 显式注入，任何环境行为恒定

## 已知 flake 登记

处置口径：全量跑失败 + 单跑通过 + 在不含改动的基点 commit 复现同样失败 → 判预存环境抖动，不阻塞合并，登记于此防重复排查。新 flake 先按此三步验证再入表。

| 用例 | 症状 | 根因 | 首次确认 |
|---|---|---|---|
| `cloud-domain-pack.spec.ts:36`（原 35）云端合法域包出现在学生端列表 | `ERR_CONNECTION_CLOSED` 进 console 卫生断言 | 演练场漏桩（`practice_progress` 真连占位主机），已补桩根治（#98） | 2026-11-02（#68 在基点复跑 3/4 同败证实） |
| `cloud-domain-pack.spec.ts:54`（原 53）云端非法域包不进入加载结果 | 同上（全量败、单跑过，基点 b97b8dd 全量同败） | 同上，已补桩根治（#98） | 2026-11-03（#85 三步口径验证） |
| `practice-config.spec.ts:119`（原 118）内置包A 配置改 7 题学生端生效 | 同上（全量败、单跑过，基点 b97b8dd 全量同败） | 同上，已补桩根治（#98） | 2026-11-03（#85 三步口径验证） |
| `admin-console.spec.ts:205`（原 214→217）无权限点直访 `/admin` 被重定向 | 时序抖动偶发失败 | 演练场漏桩（`domain_pack_asset` / `pack_exposure` 真连占位主机），已补桩根治（#98） | 2026-11-02（单跑即过） |
| `.scratch/*/shoot.spec.ts` prefers-color-scheme 逐字节探针（**非全量用例**，.scratch 探针） | light/dark 截图逐字节不一致误报（main 基点构建串行偶发、并行 4/4 败） | 逐字节对未冻结的动画/光标状态敏感；三期复用探针形态时先改像素容差或 settle 冻结后再比 | 2026-11-04（#102 施工记录待办 1，基点 a6517c1 复现） |
