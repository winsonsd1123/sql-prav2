# 后台管理鉴权：API 层验证，不引入 cookie session

演练场的会话是 PKCE 模式存储于浏览器 localStorage 的（ADR-0004 全栈形态的延续），服务端读不到会话；后台管理需要服务端鉴权时面临选择：整体迁移到 `@supabase/ssr` cookie 会话换取服务端 layout 守卫，或保持现有会话形态、把安全边界放在管理 API 上。本 ADR 决策采用后者：`/admin` 页面守卫是纯客户端组件（体验层，复用权限点判定显隐与重定向），每个 `/api/admin/*` 路由自行执行鉴权链——`Authorization: Bearer` 交云端认证服务验明身份，再以 service_role 查权限点「访问后台」，通过后才执行管理写操作。与 ADR-0005「后端路由与 RLS 才是安全边界」一脉相承。

## Considered Options

- **Cookie session 全面改造（@supabase/ssr）**：可获得服务端 layout 守卫与中间件拦截，但需重构 login/register/忘记密码全链路与所有前端会话读取，波及面大；收益仅为守卫位置提前一层，被否决。
- **仅客户端守卫、管理 API 不鉴权**：实现最少，但管理接口对任何持有会话者裸奔，界面显隐形同虚设，违反 ADR-0005 的两层验证原则，被否决。

## Consequences

- 每个 admin 路由都携带相同鉴权链（验 token → 查权限点 → service_role 操作），以共享服务层函数收口，防止新增路由漏挂。
- 客户端守卫被绕过（直接访问 `/admin` URL）只损失体验、不损失安全；反之 API 永不失守。
- 管理员自我保护（不可回收自己的管理员角色、不可禁用自己）在 API 层强制校验，UI 禁用仅为体验层。
- 将来若整体迁移 cookie 会话，鉴权链中「取身份」一步可平移为服务端会话读取，API 形态不变。
