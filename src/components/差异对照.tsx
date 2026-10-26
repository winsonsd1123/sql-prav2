"use client";

// 判定不等时的并排差异对照（issue #9）：渲染 构造对照 产出的视图，差异行/列/单元格高亮。
// T1 换皮为账本表格风（issue #12）：表头深底粗体、行间细线、极淡斑马纹、等宽数据。

import { 构造对照, type 对照侧视图 } from "@/components/对照";
import { 显示 } from "@/kernel/execute";
import type { 结果集 } from "@/kernel/types";

function 侧表格({ 标题, 侧 }: { 标题: string; 侧: 对照侧视图 }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-bold text-ink/70">{标题}</p>
      <div className="卡片 overflow-auto rounded-none">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink/10">
            <tr>
              {侧.列名.length > 0 ? (
                侧.列名.map((列, i) => (
                  <th
                    key={i}
                    className={`px-2 py-1 text-left font-bold whitespace-nowrap ${
                      侧.列差异[i]
                        ? "border-b-2 border-fail bg-fail/15 text-fail"
                        : "border-b-2 border-border-strong"
                    }`}
                    title={侧.列差异[i] ? "预期结果中没有对应列" : undefined}
                  >
                    {列}
                    {侧.列差异[i] ? " ⚠" : ""}
                  </th>
                ))
              ) : (
                <th className="px-2 py-1 text-left font-bold">（无列）</th>
              )}
            </tr>
          </thead>
          <tbody>
            {侧.行.map((行, i) => (
              <tr
                key={i}
                className={`border-b border-ink/15 odd:bg-ink/[0.03] ${
                  侧.行差异[i] ? "bg-fail/15" : ""
                }`}
              >
                {行.map((格, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 whitespace-nowrap ${
                      格.差异 ? "font-bold text-fail outline outline-1 outline-fail" : ""
                    }`}
                  >
                    {格.值 === null ? <em className="text-ink/40">NULL</em> : 显示(格.值)}
                  </td>
                ))}
              </tr>
            ))}
            {侧.行.length === 0 && (
              <tr>
                <td className="px-2 py-1 text-ink/40">（空结果）</td>
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
      {视图.截断说明 && <p className="text-xs text-warn">{视图.截断说明}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <侧表格 标题="你的结果" 侧={视图.左} />
        <侧表格 标题="预期结果" 侧={视图.右} />
      </div>
      <p className="text-xs text-ink/50">
        红色行为差异行，深红单元格为具体不等的位置
        {ordered ? "（本题含 ORDER BY，行序敏感）" : "（行序不敏感，红色行为多出/缺失的行）"}。
      </p>
    </div>
  );
}
