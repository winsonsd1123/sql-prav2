"use client";

// 两层提示逐层揭示 + 参考答案查看（issue #9）。
// 状态不落在本组件（随会话进度持久），只负责展示与回调。

import { useState } from "react";

export interface 提示与答案属性 {
  提示: [string, string];
  参考答案: string;
  已看层数: number; // 0/1/2
  已借助答案: boolean;
  // 两级解锁（issue #16，ADR-0003）：尝试次数门槛 + 已通过的题全解锁
  已通过: boolean;
  提示已解锁: boolean;
  答案已解锁: boolean;
  尝试次数: number;
  on揭示提示: () => void;
  on查看答案: () => void;
}

export default function HintsPanel({
  提示,
  参考答案,
  已看层数,
  已借助答案,
  已通过,
  提示已解锁,
  答案已解锁,
  尝试次数,
  on揭示提示,
  on查看答案,
}: 提示与答案属性) {
  const [答案已展开, 设答案已展开] = useState(false);
  const [等待确认, 设等待确认] = useState(false);

  // 锁定态按钮直接标明解锁条件（spec 用户故事 16）
  const 提示锁定说明 = 已通过 ? "" : "先验证一次解锁提示";
  const 答案剩余次数 = Math.max(0, (已看层数 >= 1 ? 2 : 3) - 尝试次数);
  const 答案锁定说明 = 已通过
    ? ""
    : 已看层数 >= 1
      ? `再试 ${答案剩余次数} 次解锁答案`
      : `再试 ${答案剩余次数} 次或看提示后解锁答案`;
  return (
    <div className="space-y-3" data-testid="提示与答案">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={on揭示提示}
            disabled={已看层数 >= 2 || !提示已解锁}
            data-testid="提示按钮"
            className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-200"
          >
            {已看层数 === 0
              ? "显示提示（第 1 层：思路）"
              : 已看层数 === 1
                ? "再显示一层（第 2 层：关键子句）"
                : "两层提示已全部显示"}
          </button>
          {!提示已解锁 && (
            <span data-testid="提示锁定说明" className="text-xs text-zinc-400">
              🔒 {提示锁定说明}
            </span>
          )}
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
              // 通过后查看仅展示不记录（语义收紧）；通过前先弹确认框
              if (已通过) 设答案已展开(true);
              else 设等待确认(true);
            }}
            disabled={!答案已解锁}
            data-testid="答案按钮"
            className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {答案已展开 ? "参考答案已显示" : "查看参考答案"}
          </button>
          {!答案已解锁 && (
            <span data-testid="答案锁定说明" className="text-xs text-zinc-400">
              🔒 {答案锁定说明}
            </span>
          )}
          {等待确认 && (
            <div
              data-testid="答案确认框"
              className="w-full max-w-md space-y-3 rounded-md border-2 border-zinc-900 bg-white p-4 shadow-[4px_4px_0_0] shadow-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:shadow-zinc-100"
            >
              <p className="text-sm font-bold">查看参考答案？</p>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                通过前查看将记入进度：本题将永久标注「已借助答案」，并计入会话总结的完成分档。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    设等待确认(false);
                    设答案已展开(true);
                    on查看答案();
                  }}
                  data-testid="确认查看答案"
                  className="rounded border-2 border-zinc-900 bg-purple-600 px-3 py-1 text-sm font-bold text-white dark:border-zinc-100"
                >
                  确认查看（将记入进度）
                </button>
                <button
                  onClick={() => 设等待确认(false)}
                  className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  再想想
                </button>
              </div>
            </div>
          )}
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
