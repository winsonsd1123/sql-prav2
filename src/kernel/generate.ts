import type { 域包, 会话, 表实例, 表定义, 题目实例, 题目模板 } from "./types";
import { 创建随机源, type 随机源 } from "./prng";

/**
 * 生成（判题内核接缝之一）：种子 + 域包 → 会话。
 * 纯函数：不触碰 IO、Date、Math.random；同种子字节级复现。
 * 四层随机化（表名/列名、题目参数、数据、刻意注入）全部由同一随机源按种子驱动。
 */
export function 生成(种子: number, 域包: 域包): 会话 {
  const 随机 = 创建随机源(种子);
  // 第一层：表名/列名实例化——每语义角色从候选池按种子选定实际名。
  const 命名 = new Map<string, { 实际表名: string; 列: Map<string, string> }>();
  for (const 表 of 域包.库骨架) {
    const 列 = new Map<string, string>();
    const 已用 = new Set<string>();
    const 选名 = (候选: string[] | undefined, 角色: string): string => {
      const 池 = 候选 && 候选.length > 0 ? 候选 : [角色];
      let 名 = 随机.抽取(池);
      // 同表内实际名不允许碰撞（候选池有交叠时顺延取下一个未用名）
      let i = 池.indexOf(名);
      while (已用.has(名) && i < 池.length - 1) 名 = 池[++i];
      if (已用.has(名)) throw new Error(`列名候选池不足以避免碰撞：${表.表名}.${角色}`);
      已用.add(名);
      return 名;
    };
    if (表.序列主键) 列.set(表.序列主键.列名, 选名(表.序列主键.列名池, 表.序列主键.列名));
    for (const c of 表.列) 列.set(c.列名, 选名(c.列名池, c.列名));
    命名.set(表.表名, { 实际表名: 选名(表.表名池, 表.表名), 列 });
  }

  // 数据生成（第三、四层随机）：引用列按被引用表的实际值取值。
  const 已生成表 = new Map<string, 表实例>();
  for (const 表 of 域包.库骨架) {
    已生成表.set(表.表名, 生成表(表, 随机, 已生成表, 命名));
  }

  return {
    种子,
    域包ID: 域包.域包ID,
    库: { 表: 域包.库骨架.map((t) => 已生成表.get(t.表名)!) },
    题目: 域包.题目模板.map((模板) => 实例化模板(模板, 已生成表, 随机, 命名)),
  };
}

function 生成表(
  表: 表定义,
  随机: 随机源,
  已生成表: Map<string, 表实例>,
  命名: Map<string, { 实际表名: string; 列: Map<string, string> }>,
): 表实例 {
  const 本表命名 = 命名.get(表.表名)!;
  // 引用池以语义角色为键，值取自被引用表（被引用表先于本表生成）
  const 引用池 = new Map<string, (string | number | null)[]>();
  for (const 列 of 表.列) {
    if (列.引用) {
      const 被引用 = 已生成表.get(列.引用.表);
      if (!被引用) throw new Error(`引用了未生成的表：${列.引用.表}`);
      const 实际列名 = 命名.get(列.引用.表)!.列.get(列.引用.列);
      if (!实际列名) throw new Error(`未知引用列：${列.引用.表}.${列.引用.列}`);
      const idx = 被引用.列名.indexOf(实际列名);
      引用池.set(列.列名, 被引用.行.map((r) => r[idx]));
    }
  }

  const 行: (string | number | null)[][] = [];
  for (let i = 0; i < 表.行数; i++) {
    const 行值: (string | number | null)[] = [];
    if (表.序列主键) 行值.push(表.序列主键.起始值 + i);
    for (const 列 of 表.列) {
      if (表.序列主键 && 列.列名 === 表.序列主键.列名) continue;
      if (引用池.has(列.列名)) {
        行值.push(随机.抽取(引用池.get(列.列名)!));
      } else if (列.空概率 !== undefined && 随机.概率(列.空概率)) {
        行值.push(null); // 第四层：刻意注入 NULL
      } else {
        行值.push(随机.抽取(列.值池));
      }
    }
    行.push(行值);
  }

  // 列定义顺序统一为：序列主键在前，其余按定义序；DDL 用实际名。
  const 角色序 = 表.序列主键 ? [表.序列主键.列名, ...表.列.map((c) => c.列名)] : 表.列.map((c) => c.列名);
  const 列名 = 角色序.map((角色) => 本表命名.列.get(角色)!);
  const 类型 = 表.序列主键 ? ["INTEGER", ...表.列.map((c) => c.类型)] : 表.列.map((c) => c.类型);
  const DDL = `CREATE TABLE ${本表命名.实际表名} (${列名
    .map((n, i) => `${n} ${类型[i]}`)
    .join(", ")});`;

  return { 表名: 本表命名.实际表名, 列名, 类型, DDL, 行 };
}

/** 实例化模板：解析语义角色占位符与参数占位符，产出可作答的题目实例 */
function 实例化模板(
  模板: 题目模板,
  已生成表: Map<string, 表实例>,
  随机: 随机源,
  命名: Map<string, { 实际表名: string; 列: Map<string, string> }>,
): 题目实例 {
  // 第二层：题目参数随机（含关联参数对象，如排序方向的描述与 SQL 关键字成对取用）
  const 实参: Record<string, unknown> = {};
  for (const [名, 候选] of Object.entries(模板.参数 ?? {})) {
    实参[名] = 随机.抽取(候选);
  }
  const 替换 = (文本: string) =>
    文本
      .replace(/\{\{table\.([^}]+)\}\}/g, (_, 表: string) => {
        const n = 命名.get(表);
        if (!n) throw new Error(`未知语义角色表：${表}`);
        return n.实际表名;
      })
      .replace(/\{\{col\.([^}.]+)\.([^}]+)\}\}/g, (_, 表: string, 角色: string) => {
        const n = 命名.get(表);
        if (!n) throw new Error(`未知语义角色表：${表}`);
        const 实际列名 = n.列.get(角色);
        if (实际列名 === undefined || !已生成表.get(表)!.列名.includes(实际列名)) {
          throw new Error(`未知语义角色列：${表}.${角色}`);
        }
        return 实际列名;
      })
      .replace(/\{\{param\.([^}]+)\}\}/g, (_, 名路径: string) => {
        // 支持 {{param.X}}（标量）与 {{param.X.子键}}（关联参数对象）
        const [名, ...子键] = 名路径.split(".");
        if (!(名 in 实参)) throw new Error(`未提供参数：${名}`);
        let 值: unknown = 实参[名];
        for (const 键 of 子键) {
          if (值 === null || typeof 值 !== "object") {
            throw new Error(`参数 ${名} 不是关联参数，不支持子键 ${键}`);
          }
          值 = (值 as Record<string, unknown>)[键];
          if (值 === undefined) throw new Error(`参数 ${名} 缺少子键 ${键}`);
        }
        return String(值);
      });

  return {
    模板ID: 模板.模板ID,
    知识点: 模板.知识点,
    难度: 模板.难度,
    题面: 替换(模板.题面),
    提示: 模板.提示.map(替换) as [string, string],
    参考答案: 替换(模板.参考答案),
    ordered: 模板.ordered,
  };
}
