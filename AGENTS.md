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
