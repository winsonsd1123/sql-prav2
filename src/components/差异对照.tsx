"use client";

// 判定不等时的并排差异对照（issue #9）：渲染 构造对照 产出的视图，差异行/列/单元格高亮。

import { 构造对照, type 对照侧视图 } from "@/components/对照";
import { 显示 } from "@/kernel/execute";
import type { 结果集 } from "@/kernel/types";

function 侧表格({ 标题, 侧 }: { 标题: string; 侧: 对照侧视图 }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">{标题}</p>
      <div className="overflow-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-900">
            <tr>
              {侧.列名.length > 0 ? (
                侧.列名.map((列, i) => (
                  <th
                    key={i}
                    className={`px-2 py-1 text-left font-medium whitespace-nowrap ${
                      侧.列差异[i] ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200" : ""
                    }`}
                    title={侧.列差异[i] ? "预期结果中没有对应列" : undefined}
                  >
                    {列}
                    {侧.列差异[i] ? " ⚠" : ""}
                  </th>
                ))
              ) : (
                <th className="px-2 py-1 text-left font-medium">（无列）</th>
              )}
            </tr>
          </thead>
          <tbody>
            {侧.行.map((行, i) => (
              <tr
                key={i}
                className={`border-t border-zinc-100 dark:border-zinc-800 ${
                  侧.行差异[i] ? "bg-red-50 dark:bg-red-950" : ""
                }`}
              >
                {行.map((格, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 whitespace-nowrap ${
                      格.差异
                        ? "bg-red-200/70 font-medium text-red-900 outline outline-1 outline-red-400 dark:bg-red-900/60 dark:text-red-100"
                        : ""
                    }`}
                  >
                    {格.值 === null ? <em className="text-zinc-400">NULL</em> : 显示(格.值)}
                  </td>
                ))}
              </tr>
            ))}
            {侧.行.length === 0 && (
              <tr>
                <td className="px-2 py-1 text-zinc-400">（空结果）</td>
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
  学生结果: 结果集;
  预期结果: 结果集;
  ordered: boolean;
}) {
  const 视图 = 构造对照(学生结果, 预期结果, ordered);
  return (
    <div className="space-y-2" data-testid="差异对照">
      {视图.截断说明 && <p className="text-xs text-amber-600 dark:text-amber-400">{视图.截断说明}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <侧表格 标题="你的结果" 侧={视图.左} />
        <侧表格 标题="预期结果" 侧={视图.右} />
      </div>
      <p className="text-xs text-zinc-400">
        红色行为差异行，深红单元格为具体不等的位置
        {ordered ? "（本题含 ORDER BY，行序敏感）" : "（行序不敏感，红色行为多出/缺失的行）"}。
      </p>
    </div>
  );
}
