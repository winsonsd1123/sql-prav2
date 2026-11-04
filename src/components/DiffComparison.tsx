"use client";

// 判定不等时的并排差异对照（issue #9）：渲染 buildComparison 产出的视图，差异行/列/单元格高亮。
// 并排差异表：表头浅底、差异行与单元格用错误色标出。

import { buildComparison, type ComparisonSideView } from "@/components/comparison";
import { formatValue } from "@/kernel/execute";
import type { ResultSet } from "@/kernel/types";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function SideTable({ title, side }: { title: string; side: ComparisonSideView }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-bold text-ink">{title}</p>
      <Card className="overflow-auto">
        <Table className="font-mono">
          <TableHeader className="bg-ink/[0.04]">
            <TableRow>
              {side.columns.length > 0 ? (
                side.columns.map((column, i) => (
                  <TableHead
                    key={i}
                    className={`h-auto py-1.5 ${
                      side.columnDiff[i]
                        ? "border-b border-fail bg-fail/10 text-fail"
                        : "border-b border-border-strong text-ink"
                    }`}
                    title={side.columnDiff[i] ? "预期结果中没有对应列" : undefined}
                  >
                    {column}
                    {side.columnDiff[i] ? " ⚠" : ""}
                  </TableHead>
                ))
              ) : (
                <TableHead className="h-auto py-1 font-bold">（无列）</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {side.rows.map((row, i) => (
              <TableRow
                key={i}
                className={`border-ink/10 odd:bg-ink/[0.02] ${side.rowDiff[i] ? "bg-fail/10" : ""}`}
              >
                {row.map((cell, j) => (
                  <TableCell
                    key={j}
                    className={`px-2 py-1 ${cell.diff ? "bg-fail/15 font-medium text-fail" : ""}`}
                  >
                    {cell.value === null ? <em className="text-muted">NULL</em> : formatValue(cell.value)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {side.rows.length === 0 && (
              <TableRow>
                <TableCell className="px-2 py-1 text-muted">（空结果）</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export default function DiffComparison({
  studentResult,
  expectedResult,
  ordered,
}: {
  studentResult: ResultSet;
  expectedResult: ResultSet;
  ordered: boolean;
}) {
  const view = buildComparison(studentResult, expectedResult, ordered);
  return (
    <div className="space-y-2" data-testid="差异对照">
      {view.truncationNote && <p className="text-xs text-warn">{view.truncationNote}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <SideTable title="你的结果" side={view.left} />
        <SideTable title="预期结果" side={view.right} />
      </div>
      <p className="text-xs text-muted">
        红色行为差异行，深红单元格为具体不等的位置
        {ordered ? "（本题含 ORDER BY，行序敏感）" : "（行序不敏感，红色行为多出/缺失的行）"}。
      </p>
    </div>
  );
}
