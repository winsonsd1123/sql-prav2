# 后台侧栏折叠走手写轻量实现，不引入 shadcn 官方 Sidebar 组件

后台侧栏交互现代化（折叠至约 64px 图标栏、lucide 图标体系、选中态左指示条、SVG 品牌 logo）时，shadcn 官方 sidebar 组件是最显眼的选项，但被否决：其 mobile 形态用 Sheet 抽屉，会把本项目窄屏「顶部横滑胶囊条」改为抽屉，直接碰撞 `admin-nav-structure.spec.ts` 以 bounding box 断言的视觉事实（窄屏横排 / 桌面纵排）；且全家桶连带拉入 sheet/skeleton 等本项目用不到的组件（YAGNI）。改为在现有 `aside` 结构上原位手写：collapsed 状态 + width 过渡 + aria 属性，tooltip 单独以 shadcn 封装引入（底层 radix-ui 统一包已在依赖，不新增包）。窄屏形态与全部既有 testid / e2e 断言零波及。图标与 logo 配色一律走既有 sidebar 主题 token，不写死色值（项目为单主题浅色工作区 + 深色侧栏，见 ADR-0011）。

## Considered Options

- **`shadcn add sidebar`（官方 Sidebar 全家桶）**：开箱即得 cookie 状态持久化、快捷键、rail 模式与 mobile Sheet，但 mobile Sheet 改窄屏形态踩 e2e bounding box 断言红线；连带组件大半用不上；其 Provider 嵌套结构对现有 32 行 layout 是重写而非增量，被否决。

## Consequences

- 折叠态仅存在于宽屏（`lg+`）；窄屏恒为横滑胶囊条（e2e 锚点，不可动摇）。
- 折叠状态 localStorage 持久化；折叠下全部菜单项（含域包组子项）逐个直达，不做 popover 二级收纳。
- 域包组的展开/收起（若依式子菜单）取 shadcn `Collapsible`（radix 原语，非 Sidebar 全家桶）：仅宽屏展开态生效，`forceMount` 保子项恒在 DOM，窄屏与 rail 态无视分组展开态；展开状态 localStorage 持久化，进入组内页面自动展开。
- 侧栏导航词汇入 GLOSSARY（直达项 / 域包组 / 折叠态）。
- 后续若窄屏确需改抽屉形态，须先重议 `admin-nav-structure.spec.ts` 的断言口径，届时再评估换官方组件。
- 窄屏基线保持优先于字号归一——spec 要求窄屏形态零波及，故窄屏侧保留 main 的任意值字号（10px/11px/1.4rem），字号归一仅宽屏（lg+）成立；后续票勿将此误判为回退（终审 Standards 轴建议）。
