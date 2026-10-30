"use client";

// 判定不等时的并排差异对照（issue #9）：渲染 buildComparison 产出的视图，差异行/列/单元格高亮。
// 并排差异表：表头浅底、差异行与单元格用错误色标出。

import { buildComparison, type ComparisonSideView } from "@/components/comparison";
import { formatValue } from "@/kernel/execute";
import type { ResultSet } from "@/kernel/types";

function 侧表格({ 标题, 侧 }: { 标题: string; 侧: ComparisonSideView }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-bold text-ink">{标题}</p>
      <div className="卡片 overflow-auto">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink/[0.04]">
            <tr>
              {侧.columns.length > 0 ? (
                侧.columns.map((列, i) => (
                  <th
                    key={i}
                    className={`px-2 py-1.5 text-left font-medium whitespace-nowrap ${
                      侧.columnDiff[i]
                        ? "border-b border-fail bg-fail/10 text-fail"
                        : "border-b border-border-strong text-ink"
                    }`}
                    title={侧.columnDiff[i] ? "预期结果中没有对应列" : undefined}
                  >
                    {列}
                    {侧.columnDiff[i] ? " ⚠" : ""}
                  </th>
                ))
              ) : (
                <th className="px-2 py-1 text-left font-bold">（无列）</th>
              )}
            </tr>
          </thead>
          <tbody>
            {侧.rows.map((行, i) => (
              <tr
                key={i}
                className={`border-b border-ink/10 odd:bg-ink/[0.02] ${
                  侧.rowDiff[i] ? "bg-fail/10" : ""
                }`}
              >
                {行.map((格, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 whitespace-nowrap ${
                      格.diff ? "bg-fail/15 font-medium text-fail" : ""
                    }`}
                  >
                    {格.value === null ? <em className="text-muted">NULL</em> : formatValue(格.value)}
                  </td>
                ))}
              </tr>
            ))}
            {侧.rows.length === 0 && (
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

export default function 差异对照({
  学生结果,
  预期结果,
  ordered,
}: {
  学生结果: ResultSet;
  预期结果: ResultSet;
  ordered: boolean;
}) {
  const 视图 = buildComparison(学生结果, 预期结果, ordered);
  return (
    <div className="space-y-2" data-testid="差异对照">
      {视图.truncationNote && <p className="text-xs text-warn">{视图.truncationNote}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <侧表格 标题="你的结果" 侧={视图.left} />
        <侧表格 标题="预期结果" 侧={视图.right} />
      </div>
      <p className="text-xs text-muted">
        红色行为差异行，深红单元格为具体不等的位置
        {ordered ? "（本题含 ORDER BY，行序敏感）" : "（行序不敏感，红色行为多出/缺失的行）"}。
      </p>
    </div>
  );
}
