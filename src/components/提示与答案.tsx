"use client";

// 两层提示逐层揭示 + 参考答案查看（issue #9）。
// 状态不落在本组件（随会话进度持久），只负责展示与回调。

import { useState } from "react";

export interface 提示与答案属性 {
  提示: [string, string];
  参考答案: string;
  已看层数: number; // 0/1/2
  已借助答案: boolean;
  on揭示提示: () => void;
  on查看答案: () => void;
}

export default function HintsPanel({
  提示,
  参考答案,
  已看层数,
  已借助答案,
  on揭示提示,
  on查看答案,
}: 提示与答案属性) {
  const [答案已展开, 设答案已展开] = useState(false);
  return (
    <div className="space-y-3" data-testid="提示与答案">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={on揭示提示}
            disabled={已看层数 >= 2}
            className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-200"
          >
            {已看层数 === 0
              ? "显示提示（第 1 层：思路）"
              : 已看层数 === 1
                ? "再显示一层（第 2 层：关键子句）"
                : "两层提示已全部显示"}
          </button>
          {已看层数 > 0 && <span className="text-xs text-zinc-400">已看 {已看层数}/2 层</span>}
        </div>
        {已看层数 >= 1 && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <strong>提示 1 · 思路：</strong>
            {提示[0]}
          </p>
        )}
        {已看层数 >= 2 && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <strong>提示 2 · 关键子句：</strong>
            <code className="font-mono">{提示[1]}</code>
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              设答案已展开(true);
              on查看答案();
            }}
            className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {答案已展开 ? "参考答案已显示" : "查看参考答案"}
          </button>
          {已借助答案 && (
            <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900 dark:text-purple-200">
              已借助答案
            </span>
          )}
        </div>
        {答案已展开 && (
          <pre className="overflow-auto rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {参考答案}
          </pre>
        )}
      </div>
    </div>
  );
}
