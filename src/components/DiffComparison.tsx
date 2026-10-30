"use client";

// 判定不等时的并排差异对照（issue #9）：渲染 buildComparison 产出的视图，差异行/列/单元格高亮。
// 并排差异表：表头浅底、差异行与单元格用错误色标出。

import { buildComparison, type ComparisonSideView } from "@/components/comparison";
import { formatValue } from "@/kernel/execute";
import type { ResultSet } from "@/kernel/types";

function SideTable({ title, side }: { title: string; side: ComparisonSideView }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-bold text-ink">{title}</p>
      <div className="卡片 overflow-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink/[0.04]">
            <tr>
              {side.columns.length > 0 ? (
                side.columns.map((column, i) => (
                  <th
                    key={i}
                    className={`px-2 py-1.5 text-left font-medium whitespace-nowrap ${
                      side.columnDiff[i]
                        ? "border-b border-fail bg-fail/10 text-fail"
                        : "border-b border-border-strong text-ink"
                    }`}
                    title={side.columnDiff[i] ? "预期结果中没有对应列" : undefined}
                  >
                    {column}
                    {side.columnDiff[i] ? " ⚠" : ""}
                  </th>
                ))
              ) : (
                <th className="px-2 py-1 text-left font-bold">（无列）</th>
              )}
            </tr>
          </thead>
          <tbody>
            {side.rows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-ink/10 odd:bg-ink/[0.02] ${
                  side.rowDiff[i] ? "bg-fail/10" : ""
                }`}
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 whitespace-nowrap ${
                      cell.diff ? "bg-fail/15 font-medium text-fail" : ""
                    }`}
                  >
                    {cell.value === null ? <em className="text-muted">NULL</em> : formatValue(cell.value)}
                  </td>
                ))}
              </tr>
            ))}
            {side.rows.length === 0 && (
              <tr>
                <td className="px-2 py-1 text-muted">（空结果）</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
