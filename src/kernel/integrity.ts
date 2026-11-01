// 参照完整性断言（纯函数，独立于生成器存在）：
// 票 #54 数据层三断言的唯一实现，供生成期自检与票 #56 域包验证闸门复用。
// 输入为 TableInstance（含结构语义标记），不依赖生成器内部状态。

import type { TableInstance } from "./types";

/** 单条完整性违规（中文 kind 可直接入报错信息与验证闸门输出） */
export type IntegrityViolation =
  | { kind: "外键悬空"; table: string; column: string; value: string | number; references: string }
  | { kind: "主键重复"; table: string; column: string; value: string | number }
  | { kind: "非空列含NULL"; table: string; column: string };

/**
 * 收集全部完整性违规：外键值全部存在于被引用表、主键唯一、声明非空的列无 NULL。
 * 无违规返回空数组；不抛错，调用方决定失败策略（生成期抛错 / 闸门收集展示）。
 */
export function collectIntegrityViolations(tables: TableInstance[]): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const byName = new Map(tables.map((t) => [t.tableName, t]));

  for (const table of tables) {
    // 列名 → 列下标（rows 以下标存值）
    const columnIndex = new Map(table.columnNames.map((name, i) => [name, i]));

    for (const fk of table.foreignKeys ?? []) {
      const idx = columnIndex.get(fk.column);
      const referenced = byName.get(fk.referencesTable);
      const referencedIdx = referenced?.columnNames.indexOf(fk.referencesColumn);
      const referencedValues =
        referenced && referencedIdx !== undefined && referencedIdx >= 0
          ? new Set(referenced.rows.map((r) => r[referencedIdx]))
          : null;
      if (idx !== undefined) {
        for (const row of table.rows) {
          const value = row[idx];
          if (value !== null && (!referencedValues || !referencedValues.has(value))) {
            violations.push({
              kind: "外键悬空",
              table: table.tableName,
              column: fk.column,
              value,
              references: `${fk.referencesTable}.${fk.referencesColumn}`,
            });
          }
        }
      }
    }

    if (table.primaryKeyColumn !== undefined) {
      const idx = columnIndex.get(table.primaryKeyColumn);
      if (idx !== undefined) {
        const seen = new Set<string | number>();
        for (const row of table.rows) {
          const value = row[idx];
          if (value !== null && seen.has(value)) {
            violations.push({ kind: "主键重复", table: table.tableName, column: table.primaryKeyColumn, value });
          }
          seen.add(value);
        }
      }
    }

    for (const column of table.notNullColumns ?? []) {
      const idx = columnIndex.get(column);
      if (idx !== undefined && table.rows.some((row) => row[idx] === null)) {
        violations.push({ kind: "非空列含NULL", table: table.tableName, column });
      }
    }
  }
  return violations;
}

/** 生成期自检：存在违规即抛错（中文明细逐条列出），供会话生成路径调用 */
export function assertDataIntegrity(tables: TableInstance[]): void {
  const violations = collectIntegrityViolations(tables);
  if (violations.length > 0) {
    const detail = violations
      .map((v) =>
        v.kind === "外键悬空"
          ? `${v.kind}：${v.table}.${v.column} = ${v.value}（应存在于 ${v.references}）`
          : v.kind === "主键重复"
            ? `${v.kind}：${v.table}.${v.column} = ${v.value}`
            : `${v.kind}：${v.table}.${v.column}`,
      )
      .join("；");
    throw new Error(`生成的数据违反参照完整性：${detail}`);
  }
}
