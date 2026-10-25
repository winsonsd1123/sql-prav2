# 领域文档

工程 skill 在探索代码库时应如何消费本仓库的领域文档。本仓库为**单上下文**布局。

## 探索前先读这些

- 仓库根目录的 **`GLOSSARY.md`**
- **`docs/adr/`**：阅读与你即将工作区域相关的 ADR

如果这些文件不存在，**静默继续**。不标记其缺失；不建议预先创建。`/domain-modeling` skill（经 `/grill-with-docs` 和 `/improve-codebase-architecture` 触达）会在术语或决策实际确定时惰性创建它们。

## 文件结构

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

## 使用词汇表的词汇

当你的输出涉及领域概念（issue 标题、重构提案、假设、测试名），使用 `GLOSSARY.md` 中定义的术语。不要漂移到词汇表明确避免的同义词。

如果你需要的概念不在词汇表中，这是一个信号：要么你在发明项目不使用的语言（重新考虑），要么存在真实缺口（记录给 `/domain-modeling`）。

## 标记 ADR 冲突

如果你的输出与现有 ADR 矛盾，显式标出而非静默覆盖：

> _与 ADR-0007（事件溯源订单）矛盾，但值得重新讨论，因为…_
