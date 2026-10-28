# 命名语言策略：代码英文，内容中文

MVP 以来代码标识符漂移为中文命名，从未有明文约定（AGENTS/文档均无此规定）。v3 用户系统迭代中，中文数据库对象名在 Supabase 生态连续实证踩坑：中文表名经 REST API 百分号编码导致 e2e mock 无法用 glob 直接匹配（被迫先宽拦再 decodeURIComponent 分流）；中文列名触发 supabase-js 列解析器类型报错（被迫放弃精确列 select）；连字符表名（角色-权限）在 SQL 中需引号包裹。产品负责人正本清源：**这是代码，应按常规代码命名（英文）；系统面向中文学生，中文属于内容与产出**。

## 决策

**英文域**（常规代码命名）：标识符、文件名、目录名、路由、数据库对象（表/列/约束/触发器/RLS 策略）、auth 元数据键。命名风格：数据库 snake_case、TS 变量与函数 camelCase、组件与类型 PascalCase、文件 kebab-case（组件文件 PascalCase）。数据库对象名优先采用 Supabase/Postgres 社区惯例（如 `profiles`），迁移内以中文注释标注 GLOSSARY 词条对照。

**中文域**：文档（GLOSSARY/ADR/README）、代码注释、测试描述字符串（describe/it）、commit message、界面文案、域包题面与试题内容、种子数据值（角色名、权限点名等——那是领域词汇与数据，不是代码符号）。

## Considered Options

- **全中文一致性（标识符也中文）**：与领域语言最贴近，但跨系统边界的工具链不兼容已被本仓库实证（Supabase REST/列解析器/e2e 编码三处踩坑）；数据库生态（Dashboard、BI、学情统计）均以 ASCII 为默认，被否决。
- **全英文（注释/文档/测试描述也英文）**：彻底统一，但开发者与最终用户皆为中文使用者，注释与文档是"给人读的产出"，中文降低沟通成本，被否决。

## Consequences

- 历史代码（`src/kernel/`、`src/components/` 历史部分、`src/domain-packs/`）仍为中文命名，作为独立技术债票处理，不阻塞本策略对新代码的约束。
- code-review 的 Standards 轴新增检查项：新代码标识符/文件名/数据库对象必须落在英文域；注释/测试描述/数据值落在中文域。
- GLOSSARY 词条的英文名承担概念对照职责（数据库对象对照注释的依据），不直接充当命名生成器（社区惯例优先）。
