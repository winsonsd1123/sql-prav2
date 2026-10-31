# 跨工具交接（Cursor 施工，Claude Code 验收）

实现工作交给外部 agent（典型：Cursor）、验收回到本仓库主会话时，走本流程。前置：票已按 mattpocock 流水线拆好、**票面完全自包含**（施工方唯一的上下文来源就是票面 + 本流程的交接文档），票在 GitHub issue 上——远端即对施工方可见，无「本地文档未 commit」坑。

## 流程

1. **截基线**（施工前，验收方执行）：Playwright 临时 spec 截现状图到 `.scratch/<feature>/before/`（桌面各页 + 移动端；登录态与 mock 模式抄最接近的现有 spec），截完删 spec。完成判据：截图落盘、`e2e/` 无残留。
2. **写交接文档**到 `$TMPDIR`，用下方模板。完成判据：路径已告知用户，由用户带到施工方。
3. **施工方施工**：从 `main` 开 feature 分支；自验 `pnpm exec playwright test` 与 `pnpm test` 全绿；产出 after 截图（覆盖更新 `.scratch/<feature>/after/`，与基线同名同尺寸）；施工记录按 `issues/` 惯例新建。不开 PR、不合并、不动 `main`。
4. **验收**（回主会话，`/code-review`）：
   - 增量固定点 = 上一张已验收票的 commit（首张票 = `main`），并给 sub-agent 附「已验收背景」防误报
   - e2e **亲测**（不采信施工方自验）+ after 截图与基线对比
   - 通过 → **issue 评论留痕**：两轴结论 + 亲测数据 + 用户拍板项 + PR 统一 Closes 的预告
   - 节奏是**一发一验收**：一张票施工、验收、通过后再交下一张——方向跑偏的代价被锁在单票内
5. **收尾**（`/pr`）：截图证据入库 `docs/screenshots/<feature>/`（before + after 同名对照，六张左右），PR body 用相对路径引用；Closes 覆盖 spec 父票 + 全部子票，对照 open issue 清单逐个核对。

## 交接文档模板（2026-10 两轮验证）

标题：`# 交接：<feature>（施工方 = Cursor）`。段落：

- **你要做什么**：票号 + `gh issue view <n>` 获取方式；总纲 spec 票号
- **分支纪律**：feature 分支名；不开 PR、不合并；commit 中文、描述行为
- **与上一票成果的衔接**：已验收内容保持不动、新件质感对齐（第二张票起需要）
- **硬约束速览**：票面条款的防呆摘要，指向票面完整版
- **上下文指针表**：`GLOSSARY.md` / 相关 ADR / e2e mock 模式所在 spec / 基线与 after 截图路径 / `issues/` 施工记录惯例
- **完成前自验**：两条命令 + 「全绿才算完」
- **等价技能要求**：验收清单逐条打勾、红了先修、Out of Scope 外一律不做（施工方无 mattpocock 技能集，此处写行为不写技能名）
- **完成后**：commit（票号入 message）、告知用户、等待验收

## 已踩坑（勿重试）

- GitHub `markdown-attachments` API 经 `gh` 调用返回 404——截图证据一律走仓库内 `docs/screenshots/`，PR 相对路径引用
- 基线必须施工前截：结构改完就截不到旧形态
