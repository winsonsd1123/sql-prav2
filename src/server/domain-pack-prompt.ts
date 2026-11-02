// 域包生成提示词组装（票 #59 / spec #53 目标②，ADR-0008）：
// 教师的「自然语言场景描述 + 可选难度 SQL 样例 + 表数意愿」→ 发给 LLM 的 system/user 提示词。
// 系统提示词完整嵌入 #56 契约（DomainPackAsset）的约束与占位符语法，
// 并满足 DeepSeek JSON 输出模式的前提：prompt 含「json」字样且给出输出格式说明。
// 样例口径参照两套内置域包（src/domain-packs/*/templates.yaml）的真实结构。
// 纯函数、无副作用，供生成服务调用与单测直接检验提示词内容。

/** 教师生成输入（与生成 API 请求体同形） */
export interface DomainPackGenerationInput {
  /** 自然语言场景描述（必填） */
  description: string;
  /** 可选：代表目标难度口味的 SQL 样例，供 LLM 对齐难度档位定义 */
  sampleSql?: string;
  /** 可选：期望表数（3-5，缺省由 LLM 自行决定） */
  tableCount?: number;
}

/** 系统提示词：域包契约全文约束（精炼但完整，与 src/kernel/domain-pack-contract.ts 口径一致） */
const SYSTEM_PROMPT = `你是 SQL 教学域包设计器。请根据用户描述，输出一个完整的 SQL 教学域包，作为一个 json 对象（只输出这个 json，不要任何解释文字或 Markdown 代码块标记）。

域包 json 的顶层字段与约束（全部必填）：

1. packId：英文小写短横线命名的唯一标识（如 "library-loan"）。
2. name：中文场景名（如 "图书馆-读者-借阅"）。
3. schemaSkeleton：库骨架数组，表数必须 3-5 张。每张表：
   - tableRole：表语义角色（中文，如 "读者"）；
   - tableNamePool：可选，2-3 个中文候选表名（缺省用角色名本身）；
   - serialKey：可选，主键自增列 { columnRole, columnNamePool?, startValue }（startValue 为整数）；
   - rowCount：非负整数（建议 15-50）；
   - columns：普通列数组。每列 { columnRole（中文语义角色）, columnNamePool?, type（"INTEGER" 或 "TEXT"）, ...取值规则 }。
     取值规则二选一：valuePool（非空候选值数组，元素为字符串或数字；中文业务值如人名/城市名；可加 nullProbability 0-1 注入 NULL 边界）
     或 reference（外键引用）{ table: 被引用表的 tableRole, column: 被引用列的 columnRole }——被引用表必须在 schemaSkeleton 中存在，禁止循环引用。
4. templates：题目模板数组，数量必须 25-35 道。每道模板：
   - templateId：英文唯一标识；
   - knowledgeArea：知识点，必须取自本包 knowledgeAreas 清单；
   - difficulty：难度 1-5 的整数，各档都要有覆盖；
   - prompt：中文题面。题面、提示与参考答案中引用表/列一律用语义角色占位符，禁止写具体表名列名：
     {{table.表角色}} 表占位符、{{col.表角色.列角色}} 列占位符、{{param.参数名}} 参数占位符；
     题面用了 {{param.参数名}} 的模板必须提供 paramPool 字段，形如 {"参数名": ["候选值1", "候选值2", "候选值3"]}——
     键为参数名、值为非空候选数组（2-5 个候选、类型一致；禁止空数组、禁止省略用到的参数）；
   - hints：恰好两条中文提示（第一条讲思路，第二条讲关键子句）；
   - referenceAnswer：参考答案 SQL（SELECT 语句，用同样占位符书写；执行后结果必须非空）。非空保证技法（数据是随机生成的，禁止硬编码常量筛选）：
     按值筛选一律写成 {{param.参数名}} 参数化，paramPool 候选值必须取自该列 valuePool（值必然存在于数据中）；
     占位符引号规则：字符串参数的占位符整体套单引号，如 ='{{param.城市}}'（数字参数不套引号，如 >={{param.及格线}}）——缺引号会被当作列名报错；
     并保证密度——被筛选列所在表 rowCount ≥ 候选值个数 × 3，多表 JOIN 沿途每张表行数充足，确保任一候选值筛选后仍有行；
   - 模板样例（格式与占位符写法照此，业务内容自行设计）：
     { "templateId": "student-city-filter", "knowledgeArea": "条件筛选与排序", "difficulty": 2,
       "prompt": "查询城市为 {{param.城市}} 的学生姓名与学号", "hints": ["先筛选城市再取需要的列", "字符串值要加单引号"],
       "referenceAnswer": "SELECT {{col.学生.姓名}}, {{col.学生.学号}} FROM {{table.学生}} WHERE {{col.学生.城市}} = '{{param.城市}}'",
       "commonMistake": "SELECT 姓名 FROM 学生 WHERE 城市 = {{param.城市}}", "ordered": false,
       "paramPool": { "城市": ["北京", "上海", "广州"] } }
   - commonMistake：典型错误写法（合法 SELECT 但结果不等价）；
   - ordered：布尔，结果是否依赖行序（依赖行序的题参考答案必须有明确 ORDER BY 与唯一决胜列）。
5. knowledgeAreas：有序中文知识点清单（建议 5-8 个，由易到难），每道模板恰好归属一项。
6. difficultyTiers：难度 1-5 五档定义，每档 { level, name, description, sampleSql }，五档齐全不可缺。
7. practiceConfig：演练配置 { totalQuestions（正整数，建议 10）, tierDistribution }，tierDistribution 键为 "1"-"5"、值为非负整数配额，各档配额之和必须等于 totalQuestions，且每档配额不得超过该档模板数量。

出题规避已知判题陷阱：不用无序 GROUP_CONCAT；不在派生表内写无效 ORDER BY；不用中文文本列排序；日期用 'YYYY-MM-DD' 文本语料。
生成后自查（历史最常犯错误）：逐个模板检查 paramPool——凡题面用了 {{param.X}} 而 paramPool 缺 X 键、或该键数组为空/仅一个候选，都会被整包拒绝；输出前务必补全 2-5 个类型一致的候选值。`;

export function buildDomainPackPrompt(input: DomainPackGenerationInput): { system: string; user: string } {
  const lines = [`请为以下场景设计 SQL 教学域包（按系统说明输出 json）：`, "", input.description.trim()];
  if (input.sampleSql !== undefined && input.sampleSql.trim() !== "") {
    lines.push("", "目标难度可参考这条 SQL 样例的口味（用于校准难度档位定义 sampleSql 的深浅）：", input.sampleSql.trim());
  }
  if (input.tableCount !== undefined) {
    lines.push("", `期望表数：${input.tableCount} 张（仍须满足 3-5 张的契约约束）。`);
  }
  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

// ── 域包微调提示词（票 #62 / ADR-0009「微调与新建共用同一闸门与契约」）──
// 微调 = 现有资产 + 修改意图 → 修改后的完整域包 JSON（不是增量补丁），
// 系统提示词复用生成契约全文（同一契约口径），追加微调专属约束。

import type { DomainPackAsset } from "@/kernel/domain-pack-contract";

/** 教师微调输入（与微调 API 请求体同形；currentPack 由服务端取当前资产注入，不信任前端） */
export interface DomainPackRefineInput {
  /** 目标域包基础名（版本后缀由服务端管理） */
  packId: string;
  /** 修改意图描述（必填） */
  intent: string;
  /** 可选：期望对齐的 SQL 样例 */
  sampleSql?: string;
  /** 当前域包资产全文（服务端取，微调的底稿） */
  currentPack: DomainPackAsset;
}

/** 微调专属约束：完整输出、packId 基础名不变、只按意图修改 */
const REFINE_ADDENDUM = `

本次是微调已有域包：以用户提供的当前域包 json 为底稿，按修改意图输出修改后的完整域包 json（同样只输出这一个 json）。额外约束：
1. packId 字段必须与当前域包完全一致，禁止改名、禁止自行添加版本后缀（版本号由系统管理）。
2. 只修改与意图相关的部分，其余字段（含题面措辞、提示、参考答案）逐字保留，禁止顺手重写。
3. 修改库骨架、表/列名称池、题目模板、知识点清单属于会产生新版本的改动；仅改难度档位定义或演练配置即时生效——请在意图明确要求时才改动对应部分。`;

export function buildRefinePrompt(input: DomainPackRefineInput): { system: string; user: string } {
  const lines = [
    "请微调以下 SQL 教学域包（按系统说明输出修改后的完整 json）：",
    "",
    "【当前域包 json】",
    JSON.stringify(input.currentPack),
    "",
    "【修改意图】",
    input.intent.trim(),
  ];
  if (input.sampleSql !== undefined && input.sampleSql.trim() !== "") {
    lines.push("", "目标难度可参考这条 SQL 样例的口味：", input.sampleSql.trim());
  }
  return { system: SYSTEM_PROMPT + REFINE_ADDENDUM, user: lines.join("\n") };
}
