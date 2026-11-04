"use client";

// 表结构面板：嵌在右栏，默认展开。列名在写 SQL 时保持可见。
// 显隐由演练场持有（顶栏「表结构」/ Cmd/Ctrl+B / Esc）。点击编辑器不收起。
// 每张表仍为 <details>，默认展开，展示表名、列（名+类型）与数据预览。

import type { TableInstance } from "@/kernel/types";
import { buildColumnAnnotations } from "@/components/library-annotations";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function LibraryBrowser({
  tables,
  instanceLabel,
  open,
  onClose,
}: {
  tables: TableInstance[];
  instanceLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  // 关闭只置 hidden 不卸载，表级 <details> 折叠状态得以保留。
  return (
    <Card asChild className="flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden">
      <aside hidden={!open} data-testid="库浏览器面板" aria-label="表结构" aria-hidden={!open}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-strong px-3 py-2.5">
          <h2 className="text-sm font-medium text-ink">
            表结构
            <span className="ml-2 font-mono text-[11px] font-normal text-muted">{instanceLabel}</span>
          </h2>
          <Button onClick={onClose} variant="outline" size="xs" className="font-normal">
            收起
          </Button>
        </div>
        <div className="space-y-2 p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
          {tables.map((tableInstance) => (
            <details
              key={tableInstance.tableName}
              className="rounded-lg bg-bg"
              data-testid="库表"
              data-表名={tableInstance.tableName}
              open
            >
              <summary className="cursor-pointer px-3 py-2 font-mono text-sm font-medium">
                {tableInstance.tableName}
                <span className="ml-2 text-[11px] font-normal text-muted">{tableInstance.rows.length} 行</span>
              </summary>
              <div className="space-y-2 px-3 pb-3 text-xs text-ink">
                <ul className="space-y-0.5">
                  {tableInstance.columnNames.map((column, i) => {
                    // 结构语义徽章（票 #54）：主键列 PK、外键列标注 FK → 被引用表.列
                    const annotation = buildColumnAnnotations(tableInstance)[column];
                    return (
                      <li key={column} className="flex items-baseline justify-between gap-3 font-mono">
                        <span className="text-ink">
                          {column}
                          {annotation?.kind === "主键" && (
                            <span className="ml-1.5 rounded-sm bg-accent/15 px-1 py-px text-[10px] font-semibold tracking-wide text-accent">
                              PK
                            </span>
                          )}
                        </span>
                        <span className="text-muted">
                          {annotation?.kind === "外键" && (
                            <span className="mr-1.5 text-[10px] text-muted/90" title={`外键 → ${annotation.target}`}>
                              FK → {annotation.target}
                            </span>
                          )}
                          {tableInstance.types[i]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="overflow-hidden rounded-lg border border-border-strong">
                  <Table className="font-mono text-xs">
                    <TableHeader className="sticky top-0 bg-panel">
                      <TableRow>
                        {tableInstance.columnNames.map((column) => (
                          <TableHead key={column} className="h-auto py-1 text-muted">
                            {column}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tableInstance.rows.map((row, i) => (
                        <TableRow key={i}>
                          {row.map((value, j) => (
                            <TableCell key={j} className="px-2 py-1">
                              {value === null ? <em className="text-muted">NULL</em> : String(value)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </details>
          ))}
        </div>
      </aside>
    </Card>
  );
}
