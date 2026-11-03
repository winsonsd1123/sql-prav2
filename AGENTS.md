<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent skills

### Issue 跟踪

Issue 以 GitHub issue 形式跟踪，通过 `gh` CLI 操作。见 `docs/agents/issue-tracker.md`。

### Triage 标签

使用默认 triage 标签词汇表（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。见 `docs/agents/triage-labels.md`。

### 领域文档

单上下文布局：仓库根目录 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。

### 跨工具交接

实现交给外部 agent（如 Cursor）施工、本仓库会话验收时：交接流程与文档模板见 `docs/agents/cursor-handoff.md`。

### E2E 测试惯例

写或改 `e2e/` spec 前读 `docs/e2e-conventions.md`（中文 testid、route 打桩、console 卫生、E2E_PORT 并行隔离、已知 flake 登记与处置口径）。

### 命名语言

代码用英文：标识符、文件/目录名、路由、数据库对象（表/列/触发器/RLS 策略）、auth 元数据键（DB snake_case / TS camelCase / 组件 PascalCase / 文件 kebab-case）。中文只用于：文档、注释、测试描述、commit message、界面文案、域包题面与试题内容、种子数据值。见 `docs/adr/0006`。

### 个人心得目录（知识库排除项）

`docs/reflections/` 是个人心得随笔，已 gitignore、不入库。它**不属于项目知识库**：扫描项目文档、拼装规范来源、建立索引或引用项目内容时，一律跳过该目录，不要读取、总结或引用其中内容。
