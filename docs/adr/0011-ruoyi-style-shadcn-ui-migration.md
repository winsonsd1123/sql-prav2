# 界面风格迁移若依 + 控件基座选 shadcn/ui，废除自建中文控件类

界面改版需求以若依 RuoYi-Vue demo（v3.8.3 色板，参照 demo.ruoyi.vip）为视觉参照：单主题浅色工作区（删除 `globals.css` 的 `prefers-color-scheme` 双分支，废弃「静室」视觉代号），仅 admin 端侧栏改深色（`#304156` 族），主色系 Element 蓝 `#409EFF`，字体与 CodeMirror 编辑器保持不变。改版同时确立控件基座：引入 shadcn/ui（127k 星，Tailwind v4 + React 19 官方支持，与本项目 `@theme inline` token 体系同构），存量手写控件全量迁移并分两期执行，`globals.css` 里的自建中文语义类（`.主按钮`/`.次按钮` 等）随之废除。若依本体是 Vue + Element UI，React 生态无存活移植，故走「shadcn 控件 + 若依色板灌主题变量」的形似路径，且不移植若依的运行时换主题机制（单主题直接写死 token 值）。

## Considered Options

- **Ant Design（100k 星）**：开箱即国产后台审美、控件覆盖最全，但 CSS-in-JS 与 Tailwind v4 原子类构成双轨样式体系，包体积大，且对 180 处 `data-testid` 的波及面比 shadcn 更大，被否决。
- **element-react**：Element UI 的 React 移植，长期停维护，直接排除。
- **延续自建中文类体系（仅改类定义值实现若依化）**：成本最低——50+ 个按钮已被 `.主按钮`/`.次按钮` 两个类收口，改类值即可全站生效；但私有约定对 Cursor/AI 施工与生态惯例不友好（用户明确要求「高星现成控件优先，不自造」），且手写弹层（SessionSummary 无焦点陷阱/无 Esc/无 Portal）与 4 处重复 notice 均有真实缺陷，被否决为终态、保留为第一期过渡。

## Consequences

- 分两期迁移：第一期 shadcn 主题基座 + 若依色板 + 改肤 + 功能收益控件（Dialog 替换手写弹层、notice 收口全局 toast、原生 select 升级，约 8-10 个文件）；第二期 50+ 按钮与 5 处手写表格全迁 shadcn、删除中文类定义。
- 180 处 `data-testid` 需逐一保真，124 个 e2e 用例全量回归一次；admin-users-list（371 行表格+分页+筛选一体）是否引入 TanStack Table 无头逻辑在第二期 spec 时定。
- 此后新控件一律取自 shadcn/ui，不再自建控件样式类；若依色板以 token 值固化于主题变量。
