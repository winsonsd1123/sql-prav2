import type { 域包, 会话, 表实例, 表定义, 题目实例, 题目模板 } from "./types";
import { 创建随机源 } from "./prng";

/**
 * 生成（判题内核接缝之一）：种子 + 域包 → 会话。
 * 纯函数：不触碰 IO、Date、Math.random；同种子字节级复现。
 */
export function 生成(种子: number, 域包: 域包): 会话 {
  const 随机 = 创建随机源(种子);
  const 已生成表 = new Map<string, 表实例>();

  for (const 表 of 域包.库骨架) {
    已生成表.set(表.表名, 生成表(表, 随机, 已生成表));
  }

  return {
    种子,
    域包ID: 域包.域包ID,
    库: { 表: 域包.库骨架.map((t) => 已生成表.get(t.表名)!) },
    题目: 域包.题目模板.map((模板) => 实例化模板(模板, 已生成表, 随机)),
  };
}

function 生成表(
  表: 表定义,
  随机: ReturnType<typeof 创建随机源>,
  已生成表: Map<string, 表实例>,
): 表实例 {
  const 引用池 = new Map<string, (string | number | null)[]>();
  for (const 列 of 表.列) {
    if (列.引用) {
      const 被引用 = 已生成表.get(列.引用.表);
      if (!被引用) throw new Error(`引用了未生成的表：${列.引用.表}`);
      const idx = 被引用.列名.indexOf(列.引用.列);
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
        行值.push(null);
      } else {
        行值.push(随机.抽取(列.值池));
      }
    }
    行.push(行值);
  }

  // 列定义顺序统一为：序列主键在前，其余按定义序。
  const 列名 = 表.序列主键
    ? [表.序列主键.列名, ...表.列.map((c) => c.列名)]
    : 表.列.map((c) => c.列名);
  const 类型 = 表.序列主键
    ? ["INTEGER", ...表.列.map((c) => c.类型)]
    : 表.列.map((c) => c.类型);
  const DDL = `CREATE TABLE ${表.表名} (${列名
    .map((n, i) => `${n} ${类型[i]}`)
    .join(", ")});`;

  return { 表名: 表.表名, 列名, 类型, DDL, 行 };
}

/** 实例化模板：解析语义角色占位符与参数占位符，产出可作答的题目实例 */
function 实例化模板(
  模板: 题目模板,
  已生成表: Map<string, 表实例>,
  随机: ReturnType<typeof 创建随机源>,
): 题目实例 {
  const 实参: Record<string, string | number> = {};
  for (const [名, 候选] of Object.entries(模板.参数 ?? {})) {
    实参[名] = 随机.抽取(候选);
  }
  // 本票列名固定：{{col.表.语义角色}} 直接解析为该表同名列（随机化在后续票落地）。
  const 替换 = (文本: string) =>
    文本
      .replace(/\{\{table\.([^}]+)\}\}/g, (_, 表: string) => {
        if (!已生成表.has(表)) throw new Error(`未知语义角色表：${表}`);
        return 表;
      })
      .replace(/\{\{col\.([^}.]+)\.([^}]+)\}\}/g, (_, 表: string, 角色: string) => {
        const 实例 = 已生成表.get(表);
        if (!实例) throw new Error(`未知语义角色表：${表}`);
        if (!实例.列名.includes(角色)) throw new Error(`未知语义角色列：${表}.${角色}`);
        return 角色;
      })
      .replace(/\{\{param\.([^}]+)\}\}/g, (_, 名: string) => {
        if (!(名 in 实参)) throw new Error(`未提供参数：${名}`);
        return String(实参[名]);
      });

  return {
    模板ID: 模板.模板ID,
    知识点: 模板.知识点,
    难度: 模板.难度,
    题面: 替换(模板.题面),
    提示: 模板.提示,
    参考答案: 替换(模板.参考答案),
    ordered: 模板.ordered,
  };
}
