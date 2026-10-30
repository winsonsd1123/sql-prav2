"use client";

// 表结构面板：嵌在右栏，默认展开。列名在写 SQL 时保持可见。
// 显隐由演练场持有（顶栏「表结构」/ Cmd/Ctrl+B / Esc）。点击编辑器不收起。
// 每张表仍为 <details>，默认展开，展示表名、列（名+类型）与数据预览。

import type { TableInstance } from "@/kernel/types";

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
    <aside
      hidden={!open}
      data-testid="库浏览器面板"
      aria-label="表结构"
      aria-hidden={!open}
      className="卡片 flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-strong px-3 py-2.5">
        <h2 className="text-sm font-medium text-ink">
          表结构
          <span className="ml-2 font-mono text-[11px] font-normal text-muted">{instanceLabel}</span>
        </h2>
        <button onClick={onClose} className="次按钮 px-2 py-0.5 text-xs text-muted">
          收起
        </button>
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
                {tableInstance.columnNames.map((column, i) => (
                  <li key={column} className="flex items-baseline justify-between gap-3 font-mono">
                    <span className="text-ink">{column}</span>
                    <span className="text-muted">{tableInstance.types[i]}</span>
                  </li>
                ))}
              </ul>
              <div className="overflow-x-auto rounded-lg border border-border-strong">
                <table className="w-full font-mono">
                  <thead className="sticky top-0 bg-panel">
                    <tr>
                      {tableInstance.columnNames.map((column) => (
                        <th key={column} className="px-2 py-1 text-left font-medium whitespace-nowrap text-muted">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableInstance.rows.map((row, i) => (
                      <tr key={i} className="border-t border-border-strong">
                        {row.map((value, j) => (
                          <td key={j} className="px-2 py-1 whitespace-nowrap">
                            {value === null ? <em className="text-muted">NULL</em> : String(value)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}
