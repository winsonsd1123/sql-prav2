// 列清单结构语义标注（票 #54）：从表实例的结构标记推导每列的徽章信息，
// 纯函数供库浏览器渲染（主键徽章 / FK → 被引用表.列 指向标注）。

import type { TableInstance } from "@/kernel/types";

export type ColumnAnnotation = { kind: "主键" } | { kind: "外键"; target: string };

/** 列名 → 徽章标注；普通列不在返回表中（无徽章）。主键优先于外键。 */
export function buildColumnAnnotations(table: TableInstance): Record<string, ColumnAnnotation> {
  const annotations: Record<string, ColumnAnnotation> = {};
  for (const fk of table.foreignKeys ?? []) {
    annotations[fk.column] = { kind: "外键", target: `${fk.referencesTable}.${fk.referencesColumn}` };
  }
  if (table.primaryKeyColumn !== undefined) {
    annotations[table.primaryKeyColumn] = { kind: "主键" };
  }
  return annotations;
}
