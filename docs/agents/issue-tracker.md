# Issue 跟踪器：GitHub

本仓库的 issue 和 spec 以 GitHub issue 形式管理。所有操作使用 `gh` CLI。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行 body 用 heredoc。
- **读取 issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合相应的 `--label` 和 `--state` 过滤器。
- **将 issue 设为父 issue 的子 issue**：`gh issue create --parent <parent> ...`，或事后 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（数据库 id，见下方 **Blocking**）。无 sub-issues 时，在子 issue body 顶部写 `Part of #<parent>`。
- **评论**：`gh issue comment <number> --body "..."`
- **添加 / 移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

从 `git remote -v` 推断仓库；在 clone 内运行时 `gh` 会自动完成。

## Pull request 作为 triage 面

**PRs as a request surface: no.** _（如果本仓库将外部 PR 视为功能请求，改为 `yes`；`/triage` 读取此开关。）_

设为 `yes` 时，PR 与 issue 使用相同的标签和状态，使用对应的 `gh pr` 命令：

- **读取 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待 triage 的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 和 PR 共享同一编号空间，裸 `#42` 可能是二者之一：用 `gh pr view 42` 解析，失败则回退 `gh issue view 42`。

## 当 skill 说"publish to the issue tracker"（发布到 issue 跟踪器）

创建一个 GitHub issue。

## 当 skill 说"fetch the relevant ticket"（获取相关 ticket）

按上方 **读取 issue** 的方式读取。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是单个 issue，**子** issue 作为 ticket。

- **Map**：单个标签为 `wayfinder:map` 的 issue，body 包含 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子 ticket**：作为 GitHub sub-issue 链接到 map（见 **将 issue 设为父 issue 的子 issue**）。sub-issues 不可用时，将子项加入 map body 的 task list，并在子 body 顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。被认领后，ticket 指派给驱动的开发者。
- **Blocking**：GitHub **原生 issue dependencies**，是 UI 可见的规范表达。添加依赖边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是 blocker 的数字 **数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number` 或 `node_id`）。GitHub 通过 `issue_dependencies_summary.blocked_by` 报告（仅开放 blocker，实时门控）。dependencies 不可用时，回退到子 body 顶部的 `Blocked by: #<n>, #<n>` 行。所有 blocker 关闭后 ticket 解锁。
- **Frontier 查询**：列出 map 的开放子项（`gh issue list --state open`，限定到 map 的 sub-issues / task list），去掉有开放 blocker（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中有开放 issue）或有 assignee 的项；按 map 顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，会话的第一次写操作。
- **解决**：`gh issue comment <n> --body "<答案>"`，然后 `gh issue close <n>`，最后将上下文指针（gist + 链接）追加到 map 的 Decisions-so-far。
