// 判题内核的领域类型，词汇以 GLOSSARY.md 为准。

/** 语义角色：列在域包中的抽象身份，本票列名固定，随机化在后续票落地 */
export interface 列定义 {
  列名: string;
  类型: "INTEGER" | "TEXT";
  /** 值生成规则：从候选值池按种子随机抽取 */
  值池: (string | number)[];
  /** 空值注入概率（0-1），刻意注入 NULL 的素材 */
  空概率?: number;
  /** 引用另一表的列取值（如 成绩.学号 引用 学生.学号） */
  引用?: { 表: string; 列: string };
}

export interface 表定义 {
  表名: string;
  列: 列定义[];
  行数: number;
  /** 该列取值唯一（用于主键），从 起始值 递增 */
  序列主键?: { 列名: string; 起始值: number };
}

export interface 题目模板 {
  模板ID: string;
  知识点: string;
  难度: number;
  /** 题面，可含占位符 {{table.X}} / {{col.T.C}} / {{param.X}} */
  题面: string;
  提示: [string, string];
  参考答案: string;
  /** 行序按序比对开关：题面含 ORDER BY 时为 true */
  ordered: boolean;
  /** 参数候选池，实例化时按种子随机选定 */
  参数?: Record<string, (string | number)[]>;
}

/** 域包：一个业务场景的完整定义 */
export interface 域包 {
  域包ID: string;
  名称: string;
  库骨架: 表定义[];
  题目模板: 题目模板[];
}

/** 规范化显示值：NULL 与空串严格区分、数值与字符串严格区分 */
export type 显示值 = string | null;

export interface 结果集 {
  列名: string[];
  行: 显示值[][];
}

export interface 表实例 {
  表名: string;
  列名: string[];
  类型: string[];
  DDL: string;
  行: (string | number | null)[][];
}

/** 题目实例：模板结合会话库实例化出的可作答题目 */
export interface 题目实例 {
  模板ID: string;
  知识点: string;
  难度: number;
  题面: string;
  提示: [string, string];
  参考答案: string;
  ordered: boolean;
}

/** 会话：一次完整练习上下文，持种子、生成的库与题目实例 */
export interface 会话 {
  种子: number;
  域包ID: string;
  库: { 表: 表实例[] };
  题目: 题目实例[];
}

/** 判定结果：通过 / 不通过（附双侧结果集）/ 错误（SQLite 原文直通）/ 拦截（演练场产品提示） */
export type 判定结果 =
  | { 判定: "通过" }
  | { 判定: "不通过"; 学生结果: 结果集; 预期结果: 结果集 }
  | { 判定: "错误"; 错误信息: string }
  | { 判定: "拦截"; 错误信息: string };
