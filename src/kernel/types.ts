// 判题内核的领域类型，词汇以 GLOSSARY.md 为准。

/**
 * 语义角色：列在域包中的抽象身份。
 * columnRole 为角色标识（模板占位符引用它）；实例化时从 columnNamePool 按种子随机选定实际列名。
 */
export interface ColumnDefinition {
  /** 列语义角色（模板占位符 {{col.表.角色}} 引用它，非实际列名） */
  columnRole: string;
  /** 实际列名候选池（2-3 个），实例化时按种子选定；缺省为 [columnRole] */
  columnNamePool?: string[];
  type: "INTEGER" | "TEXT";
  /** 值生成规则：从候选值池按种子随机抽取 */
  valuePool: (string | number)[];
  /** 空值注入概率（0-1），刻意注入 NULL 的素材 */
  nullProbability?: number;
  /** 引用另一表的列取值（如 成绩.学号 引用 学生.学号） */
  reference?: { table: string; column: string };
}

export interface TableDefinition {
  /** 表语义角色（模板占位符 {{table.角色}} 引用它，非实际表名） */
  tableRole: string;
  /** 实际表名候选池（2-3 个），实例化时按种子选定；缺省为 [tableRole] */
  tableNamePool?: string[];
  columns: ColumnDefinition[];
  rowCount: number;
  /** 该列取值唯一（用于主键），从 startValue 递增 */
  serialKey?: { columnRole: string; columnNamePool?: string[]; startValue: number };
}

export interface QuestionTemplate {
  templateId: string;
  knowledgeArea: string;
  difficulty: number;
  /** 题面，可含占位符 {{table.X}} / {{col.T.C}} / {{param.X}} */
  prompt: string;
  hints: [string, string];
  referenceAnswer: string;
  /** 行序按序比对开关：题面含 ORDER BY 时为 true */
  ordered: boolean;
  /**
   * 典型错误写法（合法 SELECT 但结果不等价），随模板静态声明，
   * 供全量判题等价回归验证判题不过松。与参考答案同占位符实例化。
   */
  commonMistake?: string;
  /**
   * 语义陷阱变体（code-review #1）：聚合/JOIN 类模板的必然不等价写法
   * （聚合函数用错、JOIN 条件错位、分组依据错位、HAVING/WHERE 混用等），
   * 与 commonMistake 互补，同占位符实例化，供全量回归验证判题不过松。
   */
  semanticTrap?: string[];
  /**
   * 参数候选池，实例化时按种子随机选定。
   * 值可为标量，也可为对象（关联参数：如排序方向的中文描述与 SQL 关键字成对取用，
   * 占位符写 {{param.X.子键}}）。
   */
  paramPool?: Record<string, (string | number | Record<string, string>)[]>;
}

/** 域包：一个业务场景的完整定义 */
export interface DomainPack {
  packId: string;
  name: string;
  schemaSkeleton: TableDefinition[];
  templates: QuestionTemplate[];
}

/** 规范化显示值：NULL 与空串严格区分、数值与字符串严格区分 */
export type DisplayValue = string | null;

export interface ResultSet {
  columns: string[];
  rows: DisplayValue[][];
}

export interface TableInstance {
  tableName: string;
  columnNames: string[];
  types: string[];
  DDL: string;
  rows: (string | number | null)[][];
}

/** 题目实例：模板结合会话库实例化出的可作答题目 */
export interface QuestionInstance {
  templateId: string;
  knowledgeArea: string;
  difficulty: number;
  prompt: string;
  hints: [string, string];
  referenceAnswer: string;
  ordered: boolean;
  /** 典型错误写法的实例化形态（模板声明时才有） */
  commonMistake?: string;
  /** 语义陷阱变体的实例化形态（模板声明时才有） */
  semanticTrap?: string[];
}

/** 会话：一次完整练习上下文，持种子、生成的库与题目实例 */
export interface Session {
  seed: number;
  packId: string;
  database: { tables: TableInstance[] };
  questions: QuestionInstance[];
}

/** 判定结果：通过 / 不通过（附双侧结果集）/ 错误（MySQL 三要素高保真映射）/ 拦截（演练场产品提示） */
export type JudgeResult =
  | { judge: "通过" }
  | { judge: "不通过"; studentResult: ResultSet; expectedResult: ResultSet }
  | { judge: "错误"; errorCode: number; SQLSTATE: string; errorMessage: string }
  | { judge: "拦截"; errorMessage: string };
