"use client";

// 库浏览器（issue #9）：整体可折叠的侧栏；每张表可折叠，展示表名、列（名+类型）与数据预览表格。
// T1 换皮为右栏黑框卡堆叠（issue #12）；T3 再抽为免遮罩浮层。

import { useState } from "react";
import type { 表实例 } from "@/kernel/types";

export default function LibraryBrowser({ 表, 实例名 }: { 表: 表实例[]; 实例名: string }) {
  const [展开, 设展开] = useState(true);
  if (!展开) {
    return (
      <aside className="w-full shrink-0">
        <button
          onClick={() => 设展开(true)}
          className="卡片 硬阴影 按压 w-full rounded-none px-3 py-2 text-left text-sm font-medium text-ink/60"
        >
          ▸ 库浏览器（{实例名}，{表.length} 张表）
        </button>
      </aside>
    );
  }
  return (
    <aside className="w-full shrink-0 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">
          库浏览器 <span className="font-mono text-xs font-normal text-ink/50">（实例：{实例名}）</span>
        </h2>
        <button
          onClick={() => 设展开(false)}
          className="卡片 按压 rounded-none px-2 py-0.5 text-xs text-ink/60"
        >
          收起
        </button>
      </div>
      {表.map((表实例) => (
        <details
          key={表实例.表名}
          className="卡片 rounded-none"
          data-testid="库表"
          data-表名={表实例.表名}
          open
        >
          <summary className="cursor-pointer border-b-2 border-dashed border-ink/20 px-3 py-2 font-mono text-sm font-semibold">
            {表实例.表名}（{表实例.行.length} 行）
          </summary>
          <div className="space-y-2 px-3 pb-2 pt-2 text-xs text-ink/70">
            <ul className="space-y-0.5">
              {表实例.列名.map((列, i) => (
                <li key={列} className="font-mono">
                  {列} <span className="text-ink/40">{表实例.类型[i]}</span>
                </li>
              ))}
            </ul>
            <div className="max-h-64 overflow-auto border-2 border-ink/20">
              <table className="w-full font-mono">
                <thead className="sticky top-0 bg-ink/10">
                  <tr>
                    {表实例.列名.map((列) => (
                      <th key={列} className="px-2 py-1 text-left font-semibold whitespace-nowrap">
                        {列}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {表实例.行.map((行, i) => (
                    <tr key={i} className="border-t border-ink/15 odd:bg-ink/[0.03]">
                      {行.map((值, j) => (
                        <td key={j} className="px-2 py-1 whitespace-nowrap">
                          {值 === null ? <em className="text-ink/40">NULL</em> : String(值)}
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
