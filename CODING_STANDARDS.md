# 编码规范（来源清单 + 判断性规则）

> 供 code review 的 Standards 轴拼装来源用。规则本体在下列各处，此处只给定位、不复制内容。工具链（`pnpm lint` / `tsc --noEmit` / `pnpm check:naming`，CI 已跑）强制的项，review 不重复报。

## 来源清单

| 来源 | 定位 |
|---|---|
| `GLOSSARY.md` | 领域术语及 avoid 同义词（如「后台管理（Admin Console）」，避免「控制面板/后台系统」） |
| `docs/adr/0006` | 命名语言边界：代码英文（DB snake_case / TS camelCase / 组件 PascalCase / 文件 kebab-case）；中文域清单（文档、注释、测试描述、commit message、界面文案、域包题面、种子数据值）。摘要另见 `AGENTS.md` |
| `docs/agents/naming-map.md` | 历史译名映射（#32 已归档：译名疑问可查表，表里没有的直接自定、遵守 ADR-0006 风格） |
| `docs/adr/0005` | RBAC：判定只认权限点，不认角色 |
| `docs/adr/0007` | 后台鉴权定在 API 层 |
| `docs/agents/domain.md` | agent 输出（issue 标题、测试名、重构提案等）使用 GLOSSARY 词汇，不漂移 |
| `issues/` | 施工记录惯例：「日期-标题.md」，上下文/计划/执行记录三段 |
| `docs/screenshots/` | 验收视觉证据归档：`<feature>/before|after/` 同名同尺寸对照 |

## 判断性规则（本文件持有）

1. **静默降级必须注释意图**：吞异常（如 `.catch(() => {})`）、空值降级渲染等放弃错误信息的写法，配一行中文注释写明降级后的可见行为（如「获取失败则邮箱留空，登出不受影响」）。
