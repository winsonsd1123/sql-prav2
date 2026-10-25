"use client";

// 库浏览器（issue #9）：整体可折叠的侧栏；每张表可折叠，展示表名、列（名+类型）与数据预览表格。

import { useState } from "react";
import type { 表实例 } from "@/kernel/types";

export default function LibraryBrowser({ 表, 实例名 }: { 表: 表实例[]; 实例名: string }) {
  const [展开, 设展开] = useState(true);
  if (!展开) {
    return (
      <aside className="w-full shrink-0 lg:w-72">
        <button
          onClick={() => 设展开(true)}
          className="w-full rounded border border-zinc-200 px-3 py-2 text-left text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          ▸ 库浏览器（{实例名}，{表.length} 张表）
        </button>
      </aside>
    );
  }
  return (
    <aside className="w-full shrink-0 space-y-2 lg:w-72">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-zinc-500">
          库浏览器 <span className="text-sm text-zinc-400">（实例：{实例名}）</span>
        </h2>
        <button
          onClick={() => 设展开(false)}
          className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          收起
        </button>
      </div>
      {表.map((表实例) => (
        <details
          key={表实例.表名}
          className="rounded border border-zinc-200 dark:border-zinc-800"
          data-testid="库表"
          data-表名={表实例.表名}
          open
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            {表实例.表名}（{表实例.行.length} 行）
          </summary>
          <div className="space-y-2 px-3 pb-2 text-xs text-zinc-500">
            <ul className="space-y-0.5">
              {表实例.列名.map((列, i) => (
                <li key={列} className="font-mono">
                  {列} <span className="text-zinc-400">{表实例.类型[i]}</span>
                </li>
              ))}
            </ul>
            <div className="max-h-64 overflow-auto rounded border border-zinc-100 dark:border-zinc-800">
              <table className="w-full">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                  <tr>
                    {表实例.列名.map((列) => (
                      <th key={列} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                        {列}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {表实例.行.map((行, i) => (
                    <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                      {行.map((值, j) => (
                        <td key={j} className="px-2 py-1 whitespace-nowrap">
                          {值 === null ? <em className="text-zinc-400">NULL</em> : String(值)}
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
    </aside>
  );
}
