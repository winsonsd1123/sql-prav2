# 命名对照表（#32 全库英文化总表）

NT1–NT6 的**唯一译名来源**：GLOSSARY 词条英文名为基准，本表为全量映射。**禁止现场发明译名**——表里没有的先入表后使用。camelCase（函数/变量/props）、PascalCase（类型/组件）、SCREAMING_SNAKE（模块级常量）。

**节域规则**：各表格的译名仅在该节所述文件/语境生效；通用速查是缺省映射。同词在不同节出现不同译名（如「项」通用 item、worker 语境 entry）不是矛盾——按所在文件查所属节，无专属节时用速查。

## 三条已定边界（勿再议）

1. `data-testid` 的中文值**保留**（UI 定位契约，改动 = 全量 e2e 选择器 churn）
2. 注释、测试 describe/it 描述、界面文案、错误提示文案**保留中文**
3. 域包 `templates.yaml` 的**内容**（题面/提示/答案文本）保留中文；**结构键**属代码域，随本表改（见深水区）

## 一、核心类型与导出 API（kernel）

| 现名 | 目标名 | 备注 |
|---|---|---|
| 列定义 | ColumnDefinition | types |
| 表定义 | TableDefinition | types |
| 题目模板 | QuestionTemplate | types/yaml 契约 |
| 域包 | DomainPack | types |
| 显示值 | DisplayValue | types |
| 结果集 | ResultSet | types |
| 表实例 | TableInstance | types |
| 题目实例 | QuestionInstance | types |
| 会话 | Session | types |
| 判定结果 | JudgeResult | types |
| 创建随机源 | createRandomSource | prng |
| 随机源 | RandomSource | prng |
| 生成 | generateSession | generate.ts（全模板实例化） |
| 生成练习会话 | generatePracticeSession | 出题.ts（分区抽 10 题） |
| 知识点顺序 | knowledgeAreaOrder | 出题.ts |
| 结果等价 | isResultEquivalent | equivalence.ts |
| 规范行 | canonicalRow | equivalence.ts |
| 引擎 | SqlJsStatic | execute.ts |
| 数据库 | Database | execute.ts |
| 已加载引擎 | loadedEngine | execute.ts |
| 加载引擎 | loadEngine | execute.ts |
| 预热引擎 | warmUpEngine | execute.ts |
| 打开内存库 | openInMemoryDb | execute.ts |
| 清洗语句 | sanitizeStatement | execute.ts |
| 规范化 | normalizeValue | execute.ts |
| 执行查询 | executeQuery | execute.ts |
| 显示 | formatValue | execute.ts |
| 判定 | judge | judge.ts 核心 |
| 校验语法 | validateSyntax | 错误映射 |
| 校验分组 | validateGroupBy | 错误映射 |
| 映射运行时错误 | mapRuntimeError | 错误映射 |
| MySQL错误 | MySqlError | 错误映射 |
| 格式化 | formatError | 错误映射 |
| 表概要 | TableSummary | 错误映射 |
| 词 | Token | 错误映射 |
| 引用 | ColumnRef | 错误映射 |
| 引用事件 | RefEvent | 错误映射 |
| 转译 | translateSql | 转译.ts |
| 垫片宿主 | ShimHost | 转译.ts |
| 注册垫片函数 | registerShimFunctions | 转译.ts |
| 执行超时毫秒 | EXECUTION_TIMEOUT_MS | 防护.ts |
| 结果行数上限 | RESULT_ROW_LIMIT | 防护.ts |
| 防护超限错误 | GuardLimitError | 防护.ts |
| 超时提示 | TIMEOUT_MESSAGE | 防护.ts |
| 行数上限提示 | ROW_LIMIT_MESSAGE | 防护.ts |
| 环境异常提示 | ENV_ERROR_MESSAGE | 防护.ts |
| 等待项 | PendingRequest | worker客户端 |
| 请求判定 | requestJudge | worker客户端 |
| 订阅引擎就绪 | subscribeEngineReady | worker客户端 |
| 引擎是否就绪 | isEngineReady | worker客户端 |
| Worker请求 / Worker应答 | WorkerRequest / WorkerResponse | 执行worker |

### 错误映射.ts 内部函数（非导出）

| 现名 | 目标名 |
|---|---|
| 偏移 / 行首 / near文本 | offsetOf / lineStart / nearText |
| 标识符（类型）/ 标识符字符 / 边界 | Identifier / identifierChars / wordBoundary |
| 找回写法 / 带前缀 / 在WHERE中 | recoverQualifiedUsage / qualifiedRegex / isInWhereClause |
| 扫描 / 切分 / 收集引用 | tokenize / splitTopLevel / collectRefs |
| 聚合函数集 / 保留词集 | aggregateFunctions / keywords |

### 转译.ts 内部（非导出）

| 现名 | 目标名 |
|---|---|
| 两位 / 日期时刻 / 解析日期 / 毫秒 | pad2 / DateTimeParts / parseDate / toMs |
| 月份英文 / 星期英文 / 格式化日期 / 文本时刻 | monthNames / weekdayNames / formatDate / formatDateTime |
| 时制12 / 年内日 / 星期 / 出 | hour12 / dayOfYear / weekday / out |
| 字符串化 / 注册变参函数 / 定长 | stringify / registerVariadic / fixedArity |
| 去重拼接状态 | GroupConcatState |

## 二、核心类型与导出 API（components）

| 现名 | 目标名 | 备注 |
|---|---|---|
| 创建本地存储 | createLocalStorage | 本地存储.ts |
| 本地存储 / 本地存储配置 | LocalStorage / LocalStorageOptions | |
| 域包注册表 | domainPackRegistry | 会话存储.ts |
| 种子存储 / 域包存储 / 进度存储 | seedStore / packStore / progressStore | |
| 迁移进度 | migrateProgress | |
| 创建草稿保存器 | createDraftSaver | |
| 换一套种子 | regenerateSession | |
| 设域包 | setPack | |
| 实例名 | instanceLabel | GLOSSARY「库实例名」 |
| 进度记录 / 空进度 / 进度键 | ProgressRecord / emptyProgress / progressKey | 进度.ts |
| 记尝试 / 记通过 / 记草稿 / 取草稿 | recordAttempt / recordPass / saveDraft / getDraft | |
| 是否已通过 / 是否借助答案 | isPassed / usedAnswerAssistance | |
| 提示是否解锁 / 答案是否解锁 | isHintUnlocked / isAnswerUnlocked | |
| 答案解锁还差尝试 | attemptsToUnlockAnswer | |
| 揭示下一层提示 / 查看答案 | revealNextHintLayer / viewAnswer | |
| 下一未通过题 | nextUnpassedQuestion | |
| 完成度 / 完成分档统计 | completion / completionTierStats | |
| 解析进度 | parseProgress | |
| 构造对照 / 对照视图 / 对照侧视图 / 对照单元格 | buildComparison / ComparisonView / ComparisonSideView / ComparisonCell | 对照.ts |
| 行键 / 值相等 | rowKey / valuesEqual | |

### 组件与 props（UI 纵列）

| 现名 | 目标名 |
|---|---|
| 演练场 / SQL编辑器 / 库浏览器 | Playground / SqlEditor / LibraryBrowser |
| 差异对照 / 提示与答案 / 会话总结 | DiffComparison / HintsAndAnswer / SessionSummary |
| SQL编辑器属性 | SqlEditorProps |
| 构造schema | buildSchema |
| 解锁状态类型 | UnlockState |
| 会话总结Props | SessionSummaryProps |
| 分档项 | tierItem |
| prop：on拦截粘贴 | onInterceptPaste |
| prop：on查看答案 | onViewAnswer |
| prop：答案豁免 | answerExemption |

### 演练场.tsx 状态与回调（内部）

| 现名 | 目标名 | 现名 | 目标名 |
|---|---|---|---|
| 订阅桌面断点 | subscribeDesktopBreakpoint | 查询 | mediaQuery |
| 取桌面快照 | desktopSnapshot | 是桌面视口 | isDesktopViewport |
| 当前题号/设当前题号 | currentQuestionIndex/setter | SQL输入 | sqlInput |
| 结果 / 判定中 | result / judging | 用户切换面板 | userPanelToggle |
| 库浏览器开 | libraryBrowserOpen | 关闭库浏览器 | closeLibraryBrowser |
| 按键 / 面板当前开 | onKeydown / panelCurrentlyOpen | 引擎就绪 | engineReady |
| 通过反馈 | passFeedback | 取消自动跳转 | cancelAutoAdvance |
| 显示禁粘横幅 | showNoPasteBanner | 已弹过禁粘横幅 | noPasteBannerShown |
| 禁粘横幅计时器 | noPasteBannerTimer | 提示禁粘贴 | notifyNoPaste |
| 总结开 | summaryOpen | 上一全通过 / 全通过 | wasAllPassed / allPassed |
| 草稿保存器 | draftSaver | 编辑回调 | onEdit |
| 用户已编辑 | userEdited | 发起题号 | submittedIndex |
| 此前未通过 | wasUnpassed | 题目行状态（类型/函数） | QuestionRowState / rowState |
| 题目行点 | rowDotStyles | 题目分组 / 末组 | questionGroups / lastGroup |
| 重置作答 / 换一套 / 切换域包 | onReset / onNewSession / onSwitchPack | 切换题目 | switchQuestion |

### e2e 辅助函数与常量

| 现名 | 目标名 |
|---|---|
| 打开演练场 / 输入SQL / 编辑器文本 | openPlayground / typeSql / editorText |
| 禁粘横幅文本 | NO_PASTE_BANNER_TEXT |
| 模拟粘贴 / 模拟拖入 | simulatePaste / simulateDrop |
| 记一次不通过尝试 | recordOneFailedAttempt |
| 预置进度 / 预置混合进度 / 通过第0题 | seedProgress / seedMixedProgress / passQuestionZero |
| 取表名 / 全部表名 | getTableName / allTableNames |

## 三、通用词汇速查（局部变量/测试变量统一映射）

同词多处出现，统一按此译；组合词按「修饰语+核心词」拼接（如 基准表名→baseTableName、固定时刻→fixedTime、找异名种子→findRenamedSeed）：

（速查区的「题目」指局部变量持有的题目实例 QuestionInstance，非鼓励用「题目」称呼模板——词条 Avoid 边界不变）

会话→session · 种子→seed · 域包→pack/domainPack · 题目→question · 题号→questionIndex · 进度→progress · 结果→result · 表→table · 列→column · 行→row · 键→key · 值→value · 名→name · 文本→text · 当前→current · 下一个→next · 首/第一个→first · 项→item · 项列表→items · 列表→list · 集→set · 计数→count · 深度→depth · 大写→upper · 后→next · 起→start · 止→end · 区→range · 索引→index · 序→order · 状态→state · 视图→view · 实例→instance · 存储简化（测试）→store · 保存器→saver · 写入→writeFn · 回调→callback · 退订→unsubscribe · 夹具→fixture · 样本→sample · 基准→baseline · 变体→variant · 候选→candidates · 错误→error · 期望→expected · 学生→student · 预期→expected · 计时器→timer · 待写→pendingWrite · 落盘→flush · 随机→random · 域包们→packs · 种子列表→seeds · 序号们→indices · 已见→seen · 有差异→hasDiff · 全量→full · 列序颠倒→reverseColumnOrder · 含排序→hasOrderBy · 原计数→remaining……（剩余通用词按同一规则类推）

## ⚠️ 深水区：interface 字段 = 跨文件数据契约

`types.ts` 的字段名同时是三处契约，**必须同批联动改**（NT1 改类型、NT5 改两份 yaml 结构键、NT3 改进度 JSON 字段并重置既有进度数据）：

| 字段（现） | 目标名 | 契约面 |
|---|---|---|
| 表名（表定义，角色名）| tableRole | yaml 结构键 |
| 列名（列定义，角色名）| columnRole | yaml 结构键 |
| 表名池 / 列名池 | tableNamePool / columnNamePool | yaml |
| 序列主键 | serialKey | yaml |
| 库骨架 | schemaSkeleton | yaml |
| 模板ID / 知识点 / 难度 / 题面 | templateId / knowledgeArea / difficulty / prompt | yaml |
| 两级提示 / 参考答案 / 错误写法 / 语义陷阱 / 参数池 | hints / referenceAnswer / commonMistake / semanticTrap / paramPool | yaml |
| 值池 / 空值概率 / 引用 / 行 / 类型 | valuePool / nullProbability / reference / rows / type | yaml |
| 库 / 表 / 列 | database / tables / columns | 内部结构 |
| 已通过题号 / 已看提示 / 已借助答案题号 / 尝试次数 / 草稿 | passedIndices / hintsSeen / assistedAnswerIndices / attemptCounts / drafts | **进度 JSON（localStorage + 云端 JSONB）——改后既有联调数据作废重置** |

## 完成核对

每票合入前自查：`node scripts/check-naming.mjs` 棘轮行清零即本表在该文件全部落地；NT6 收尾时本表归档（标注"已完成，仅供考古"）。

## 四、逐词补遗表（局部变量/测试变量，与前表合为完整映射）

### 错误映射/判题 内部细化

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| FROM区 | fromClause | SELECT区 | selectClause | 子句边界 | clauseBoundaries |
| 取子句 | clauseOf | 边界序 | boundaryOrder | 后随BY | followedByBy |
| select数 | selectCount | 列表项 | selectItems | 项引用 | itemRefs |
| 分组列 | groupByColumns | 前缀映射 | aliasToTable | 段列表 | segments |
| 名词 | identifierTokens | 表词 | tableToken | 别名词 | aliasToken |
| 第二 | second | 第三 | third | 定位 | locate |
| 解析列 | resolveColumn | 解析 | resolved | 指向 | aliasTarget |
| 首个（首个违规引用） | firstViolation | 文案（错误文案类型） | ErrorMessageKind | 中断 | broken |
| 跳过括号 | skipParens | 区 | range | 起 | start |
| 止 | end | 索引 | index | 事件 | events |
| 模式 | pattern | 写法 | usage | 子句 | clause |
| 库名 | dbName | 错误 | errors | 首（第一个元素） | first |
| 清洗 | sanitized | 映射 | mapped | 学生结果 | studentResult |
| 预期结果 | expectedResult | 语法错误 | syntaxError | 分组错误 | groupByError |
| 解析器 | parser | 边界 | wordBoundary | 引 | quote |

### generate/出题 内部

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| 命名 | nameMap | 选名 | pickName | 已生成表 | generatedTables |
| 生成表 | generateTable | 本表命名 | tableNaming | 引用池 | referencePool |
| 被引用 | referencedTable | 实际列名 | actualColumnNames | 行值 | rowValues |
| 角色序 | roleOrder | 实例化模板 | instantiateTemplate | 实参 | args |
| 替换 | substitute | [名 | [name | 子键 | childKeys |
| 池 | pool | 名 | name | 已用 | used |
| 列 | columnMap | 洗牌 | shuffle | 分区 | partitions |
| 配额 | quota | 有余量 | quotaLeft | 题数 | questionCount |
| 随机 | random | 题目 | questions | 角色 | role |

### worker/执行 内部

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| 就绪标志 | readyFlag | 就绪等待者们 | readyWaiters | 下一个id | nextId |
| 等待中 | pending | 引擎就绪订阅 | engineReadySubscribers | 当前超时毫秒 | currentTimeoutMs |
| 覆盖 | override | 通报就绪 | notifyReady | 拒绝全部 | rejectAll |
| 创建worker | createWorker | 消息 | message | 等待者们 | waiters |
| 项（等待中映射条目） | entry | 确保worker就绪 | ensureWorkerReady | 超时器 | timer |
| 请求 | request | 超时文案 | timeoutMessage | 上下文 | ctx |
| 在浏览器 | isBrowser | 占位 | placeholders | 文本 | text |

### 转译/存储/进度 内部

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| 现在 | now | 当下 | nowParts | [分隔符 | [separator |
| 其余 | rest | 状态 | state | 字面量 | literalRegex |
| 缓存 | cache | 客户端键 | clientKey | 订阅者 | subscribers |
| 种子键 | SEED_KEY | 域包键 | PACK_KEY | 来自URL | fromUrl |
| 新种子 | newSeed | 待写 | pendingWrite | 计时器 | timer |
| 落盘 | flush | 域包ID | packId | 域包A | packA |
| 加载域包A | loadPackA | 加载域包B | loadPackB | 骨架 | skeleton |
| 次 | count | 尝试 | attempts | 已看 | hintSeen |
| 门槛 | threshold | 新层数 | nextLayer | 题号 | questionIndex |
| 独立完成 | independent | 借助提示 | withHints | 借助答案 | withAnswer |
| 借助 | assisted | 提示 | hints | 草稿 | drafts |
| 现有 | existing | 新草稿 | newDrafts | 键 | key |

### 对照/差异 内部

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| 预期列位置 | expectedColumnIndex | 学生到预期 | studentToExpected | 已占用 | occupied |
| 重排 | aligned | 殿后 | trailing | 学生列序 | studentColumnOrder |
| 左列名 | leftColumns | 右列名 | rightColumns | 左行 | leftRows |
| 右行 | rightRows | 左列差异 | leftColumnDiff | 右列差异 | rightColumnDiff |
| 左差异行 | leftRowDiff | 右差异行 | rightRowDiff | 左标记 | leftMarks |
| 右标记 | rightMarks | 行数 | rowCount | 宽 | width |
| 单元差异 | cellDiffs | 行不等 | rowDiffers | 原计数 | originalCounts |
| 剩余 | remaining | 余量 | remainingCount | 出现序 | occurrenceIndex |
| 序 | occurrence | 截断 | truncated | 截取 | sliceView |
| 单元 | cellMarks | 学生 | student | 预期 | expected |
| 侧表格 | SideTable | 学 | student | 预 | expected |
| 等 | equal | 不等 | unequal | 视图2 | view2 |
| 行 | row | 结果 | result | 计数 | counts |

### UI 组件内部

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| 值引用 | valueRef | 容器 | containerRef | 视图 | viewRef |
| 提交回调 | submitCallbackRef | 拦截回调 | interceptCallbackRef | 扩展 | extensions |
| 视图实例 | viewInstance | 实例 | instance | 内容 | content |
| 提示与答案属性 | HintsAndAnswerProps | 提示锁定说明 | hintLockHint | 答案锁定说明 | answerLockHint |
| [答案已展开 | [answerExpanded | [等待确认 | [awaitingConfirm | 答案已解锁 | answerUnlocked |
| 当前题号引用 | currentQuestionIndexRef | 通过反馈引用 | passFeedbackRef | 目标 | target |
| 目标域包 | targetPack | 答案豁免 | answerExemption | 用户切换面板Ref | userPanelToggleRef |
| [当前题号 | [currentQuestionIndex | [SQL输入 | [sqlInput | [结果 | [result |
| [判定中 | [judging | [引擎就绪 | [engineReady | [通过反馈 | [passFeedback |
| [显示禁粘横幅 | [showNoPasteBanner | [总结开 | [summaryOpen | [用户切换面板 | [userPanelToggle |
| 验证 | verify | 题目 | questions | 按钮 | button |

### 测试文件专用

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| 内存localStorage | MemoryLocalStorage | 装浏览器环境 | installBrowserEnv | 卸浏览器环境 | uninstallBrowserEnv |
| 初始化 | initFn | 存储 | store | 回调 | callback |
| 退订 | unsubscribe | 写入 | writeFn | 保存器 | saver |
| 集 | mkResultSet | 视图 | view | [再次] | [again] |
| 原 | original | 旧数据 | legacyData | 十题进度 | tenQuestionProgress |
| 唯一未过 | onlyUnpassed | 试 | attemptN | 看过提示后再试一次 | hintThenAttempt |
| 只试一次就看了提示 | attemptOnceThenHint | 看过提示 | hintSeen | 通过 | passed |
| 未通过已解锁 | unpassedUnlocked | [看前 | [beforeView | [看后 | [afterView |
| 记前/记入 | recorded | 新数据 | newData | 进度 | progress |
| 已通过 | passedProgress | 夹具 | fixture | 域包们 | packs |
| 种子列表 | seeds | 七个知识点 | SEVEN_AREAS | 深度 | depth |
| 项 | item | 含排序 | hasOrderBy | 聚合与JOIN | aggregationJoins |
| 含陷阱 | hasTraps | 变体 | variant | 错误 | wrongSql |
| 会话 | session | 固定时刻 | fixedTime | 固定文本 | fixedText |
| 时刻题 | timeQuestion | 第一次 | first | 第二次 | second |
| 三表 | allTables | 期望 | expected | 表 | mkTable |
| 库 | tables | 实际名 | actualNames | 实例表 | instanceTable |
| 角色列 | roleColumns | 代入 | substitute | 实例 | instance |
| 员工表 | employeeTable | 固定会话 | fixedSession | 实际 | actualRows |
| 学生SQL | studentSql | 表名池 | tableNamePool | 列名池 | columnNamePool |
| 基准表名 | baseTableName | 基准表名们 | baseTableNames | 表名们 | tableNames |
| 找异名种子 | findRenamedSeed | 找全表异名种子 | findAllRenamedSeed | 会话A | sessionA |
| 会话B | sessionB | 涉及列名的SQL | columnRefQueries | 题面集合 | promptSet |
| 值集合 | valueSet | 结果们 | results | 有列名差异 | hasColumnDiff |
| 序号们 | indices | 已见 | seen | 题面序 | promptOrder |
| 基准 | baseline | 有差异 | hasDiff | 全量 | full |
| 知识点顺序 | knowledgeAreaOrder | 域包 | pack | 不去重 | withoutDistinct |

### scripts（NT6 将删除，仅供届时若有保留引用）

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| 用户 | user | 密码 | password | 主机 | host |
| 仓库根 | repoRoot | 建库SQL | setupSql | 样本集 | samples |
| 执行mysql | runMysql | 版本 | version | 行 | lines |
| 列名 | columns | 数据行 | dataRows | 输出 | outputPath |
| 参数 | args | 临时目录 | tmpDir | 文件 | file |
| 目录 | dir | 路径 | pathname | 端口 | port |
| 数据 | dataTransfer | 可复制 | isCopyable | 表名 | tableName |
| 全部表名 | allTableNames | 首表 | firstTable | 答案 | answerText |

### 通用词补录（速查区行文的表格化，供核对脚本精确匹配）

| 现 | 译 | 现 | 译 | 现 | 译 |
|---|---|---|---|---|---|
| 种子 | seed | 值 | value | 当前 | current |
| 后 | next | 大写 | upper | 候选 | candidates |
| 样本 | sample | 别名 | aliases | 列序颠倒 | reverseColumnOrder |
| 词列表 | tokens | 项列表（ORDER 子句） | orderItems | 全允许 | allowedAll |
| [表词 | [tableToken | [进度 | [progress | 记入 | recorded |

## 五、文件与目录名映射（源码 kebab-case，组件 PascalCase）

| 现路径 | 目标路径 |
|---|---|
| src/kernel/出题.ts | src/kernel/question-picking.ts |
| src/kernel/转译.ts | src/kernel/sql-translate.ts |
| src/kernel/错误映射.ts | src/kernel/error-mapping.ts |
| src/kernel/防护.ts | src/kernel/guard.ts |
| src/kernel/worker客户端.ts | src/kernel/worker-client.ts |
| src/kernel/执行worker.ts | src/kernel/worker-exec.ts |
| src/components/对照.ts | src/components/comparison.ts |
| src/components/本地存储.ts | src/components/local-storage.ts |
| src/components/会话存储.ts | src/components/session-store.ts |
| src/components/进度.ts | src/components/progress.ts |
| src/components/演练场.tsx | src/components/Playground.tsx |
| src/components/SQL编辑器.tsx | src/components/SqlEditor.tsx |
| src/components/库浏览器.tsx | src/components/LibraryBrowser.tsx |
| src/components/差异对照.tsx | src/components/DiffComparison.tsx |
| src/components/提示与答案.tsx | src/components/HintsAndAnswer.tsx |
| src/components/会话总结.tsx | src/components/SessionSummary.tsx |
| src/components/__tests__/（四文件） | local-storage / comparison / progress / draft-saver 各 .test.ts |
| src/kernel/__tests__/（十文件） | 1055-static-check / practice-session / full-bank-regression / judging-time-consistency / large-query-guard / behavior-comparison / template-self-judging / fixture-regression / generation-determinism / randomization 各 .test.ts |
| src/kernel/__tests__/fixtures/（两 JSON） | mysql-behavior-fixtures.json / mysql-error-fixtures.json |
| src/domain-packs/学生课程成绩/ | src/domain-packs/student-course-grades/（内 域包A.ts→pack-a.ts） |
| src/domain-packs/员工部门薪资/ | src/domain-packs/employee-department-salary/（内 域包B.ts→pack-b.ts） |

### NT1 补录（code-review 回填：实施中确立的译名与运行时契约）

| 现 | 译 | 说明 |
|---|---|---|
| 整数 / 抽取 / 概率 | int / pick / chance | RandomSource 方法 |
| 判定（JudgeResult 判别字段） | judge | 判别字段单列 |
| 判定结果 tag 值「通过/不通过/错误/拦截」 | 保留中文 | 跨文件运行时契约（UI 徽章与判定文案同源） |
| 行数 / 起始值 / 实际表名 / 类型（表列复数） | rowCount / startValue / actualTableName / types | types 字段修饰类推 |

### NT2 补录（实施中确立的译名与运行时契约）

| 现 | 译 | 说明 |
|---|---|---|
| 时刻 | time | 判定级常量（judge/executeQuery/registerShimFunctions 参数） |
| 错误码 / 文案（MySqlError 字段） | errorCode / message | SQLSTATE 保持原名 |
| 语句 / 提示（清洗语句返回字段） | statement / message | |
| 类型 / 值（Token 字段） | kind / value | kind 的字面量值「标识符/数字/字符串/符号」保留中文（文件内判别用） |
| 前缀 / 列名 / 位置（ColumnRef 字段） | prefix / columnName / position | 引用事件字段 引用→ref |
| 学生SQL / 会话 / 题目（WorkerRequest 字段） | studentSql / session / question | WorkerResponse 字段 结果→result；type 值「就绪/结果」保留中文 |
| 种类（GuardLimitError 字段） | kind | 字面量值「超时/行数上限/环境异常」与 Error.name「防护超限错误」保留中文（运行时契约） |
| 名 / 函数 / 参数 / 聚合（ShimHost 方法参数） | name / fn / args / aggregate | |
| 最大参数数 / 原状态 | maxArity / prevState | 转译内部；GroupConcatState 字段 见过→seen、值→values、分隔符→separator |
| 号 / 显示前缀（1055 文案函数参数） | index / displayPrefix | 该局部函数名 文案→errorMessage |
| SQL文本 | sqlText | execute/转译参数 |

### NT3 补录（实施中确立的译名与数据契约）

| 现 | 译 | 说明 |
|---|---|---|
| 取键 / 初始化 / 序列化 / 未就绪快照 / 订阅集合 | getKey / init / serialize / notReadySnapshot / subscribers | LocalStorageOptions 字段 |
| 取快照 / 写 / 订阅（方法） | getSnapshot / write / subscribe | LocalStorage 方法 |
| 配置 / 缓存 / 原文 / 值 | options / cache / raw / value | local-storage 内部 |
| 排程 / 立即刷新 | schedule / flushNow | 草稿保存器方法 |
| 静默毫秒 | debounceMs | createDraftSaver 参数 |
| 豁免 | exempt | viewAnswer/isAnswerUnlocked/attemptsToUnlockAnswer 参数 |
| 当前题号 / 总题数 / 步 / 次 | currentIndex / totalQuestions / step / count | progress 内部参数 |
| 次数（attemptN 测试参数） | times | progress 测试 |
| 已完成 / 总数（completion 返回字段） | completed / total | 返回值字段 |
| 列名 / 列差异 / 行 / 行差异（对照侧视图字段） | columns / columnDiff / rows / rowDiff | ComparisonSideView 字段 |
| 左 / 右 / 截断说明 | left / right / truncationNote | ComparisonView 字段 |
| 值 / 差异（对照单元格字段） | value / diff | ComparisonCell 字段 |
| 前N行 | rowLimit | buildComparison 参数 |
| 已占用 / 名 / 位置 / 总 / 匹配 | used / name / position / count / matched | comparison 内部（matched 原名即英文） |
| 记前 / 记后 | recordedBefore / recordedAfter | progress 测试解构变量 |
| 通过 / 已通过（测试局部） | passed / passedProgress | progress 测试 |
### NT4 补录（实施中确立的译名与 props 契约）

| 现 | 译 | 说明 |
|---|---|---|
| 值 / 表 / 禁用（SQL编辑器 props） | value / tables / disabled | SqlEditor |
| cm占位（导入别名） | cmPlaceholder | SqlEditor 内部 |
| 更新（updateListener 参数） | update | SqlEditor 内部 |
| 实例名 / 打开（库浏览器 props） | instanceLabel / open | LibraryBrowser |
| 表实例（map 参数） | tableInstance | LibraryBrowser 内部 |
| 提示 / 参考答案 / 已看层数 / 已借助答案（props） | hints / referenceAnswer / layersSeen / usedAnswer | HintsAndAnswer |
| 解锁状态 / 答案还差尝试（props） | unlockState / attemptsToUnlock | HintsAndAnswer |
| on揭示提示（prop） | onRevealHint | HintsAndAnswer |
| 已通过 / 提示已解锁 / 答案已解锁 / 尝试次数（UnlockState 字段） | passed / hintUnlocked / answerUnlocked / attemptCount | UnlockState |
| 分档 / 已完成 / 总数 / on再来一套 / on关闭（props） | tiers / completed / total / onPlayAgain / onClose | SessionSummary |
| 色类 / 名称 / 数量 / 键（tierItem 参数） | colorClass / name / count / key | SessionSummary 内部 |
| 目标题号 / 倒计时中（通过反馈状态字段） | targetIndex / countingDown | Playground 内部 |
| 种子 / 域包ID / 域包 / 会话 / 进度 / 题目 | seed / packId / pack / session / progress / question | Playground 内部状态（速查映射） |
| 设SQL输入 / 设结果 / 设判定中 等 setter | setSqlInput / setResult / setJudging 等 | setState 惯例 set+名词 |
| 目标域包ID（切换域包参数） | targetPackId | Playground 内部 |
| 知识点 / 序号（题目分组字段）、组 / 状态 | knowledgeArea / indices、group / state | Playground 左栏目录 |
| 落盘（beforeunload 内局部函数） | flush | Playground 内部 |
| 题 / 行 / 值 / 列（库浏览器/差异对照 map 参数） | table→tableInstance、row、value、column | 渲染层局部 |
| 标题 / 侧 / 格 | title / side / cell | DiffComparison 内部 |

