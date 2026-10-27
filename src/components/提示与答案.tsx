"use client";

// 两层提示逐层揭示 + 参考答案查看（issue #9）。
// 状态不落在本组件（随会话进度持久），只负责展示与回调。
// 外观为静室；解锁门槛见 issue #16，ADR-0003。

import { useState } from "react";

/**
 * 解锁状态包（issue #16，ADR-0003）：尝试次数门槛 + 已通过的题全解锁。
 * 四个字段同源同变，捆绑传入避免 props 松散漂移；由调用方从 进度 一次构造。
 */
export interface 解锁状态类型 {
  已通过: boolean;
  提示已解锁: boolean;
  答案已解锁: boolean;
  尝试次数: number;
}

export interface 提示与答案属性 {
  提示: [string, string];
  参考答案: string;
  已看层数: number; // 0/1/2
  已借助答案: boolean;
  解锁状态: 解锁状态类型;
  /** 距答案解锁还差的尝试次数（门槛口径归 进度 模块，0 表示已解锁） */
  答案还差尝试: number;
  on揭示提示: () => void;
  on查看答案: () => void;
}

export default function HintsPanel({
  提示,
  参考答案,
  已看层数,
  已借助答案,
  解锁状态,
  答案还差尝试,
  on揭示提示,
  on查看答案,
}: 提示与答案属性) {
  const [答案已展开, 设答案已展开] = useState(false);
  const [等待确认, 设等待确认] = useState(false);
  const { 已通过, 提示已解锁, 答案已解锁 } = 解锁状态;

  // 锁定态按钮直接标明解锁条件（spec 用户故事 16）；次数口径来自 进度.答案解锁还差尝试
  const 提示锁定说明 = 已通过 ? "" : "先验证一次解锁提示";
  const 答案锁定说明 = 已通过
    ? ""
    : 已看层数 >= 1
      ? `再试 ${答案还差尝试} 次解锁答案`
      : `再试 ${答案还差尝试} 次或看提示后解锁答案`;
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2" data-testid="提示与答案">
      <div className="space-y-2">
        <div className="flex flex-col items-start gap-2">
          <button
            onClick={on揭示提示}
            disabled={已看层数 >= 2 || !提示已解锁}
            data-testid="提示按钮"
            className="次按钮 px-3 py-2 text-left text-sm disabled:opacity-40"
          >
            {已看层数 === 0
              ? "显示提示（第 1 层：思路）"
              : 已看层数 === 1
                ? "再显示一层（第 2 层：关键子句）"
                : "两层提示已全部显示"}
          </button>
          {!提示已解锁 && (
            <span data-testid="提示锁定说明" className="text-xs text-muted">
              {提示锁定说明}
            </span>
          )}
          {已看层数 > 0 && (
            <span className="font-mono text-xs text-muted">已看 {已看层数}/2 层</span>
          )}
        </div>
        {已看层数 >= 1 && (
          <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm leading-relaxed">
            <strong className="text-warn">提示 1 · 思路：</strong>
            {提示[0]}
          </p>
        )}
        {已看层数 >= 2 && (
          <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm leading-relaxed">
            <strong className="text-warn">提示 2 · 关键子句：</strong>
            <code className="font-mono">{提示[1]}</code>
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-col items-start gap-2">
          <button
            onClick={() => {
              // 通过后查看仅展示不记录（语义收紧）；通过前先弹确认框
              if (已通过) 设答案已展开(true);
              else 设等待确认(true);
            }}
            disabled={!答案已解锁}
            data-testid="答案按钮"
            className="次按钮 px-3 py-2 text-left text-sm disabled:opacity-40"
          >
            {答案已展开 ? "参考答案已显示" : "查看参考答案"}
          </button>
          {!答案已解锁 && (
            <span data-testid="答案锁定说明" className="text-xs text-muted">
              {答案锁定说明}
            </span>
          )}
          {等待确认 && (
            <div
              data-testid="答案确认框"
              className="w-full space-y-3 rounded-xl border border-border-strong bg-bg p-3"
            >
              <p className="text-sm font-bold">查看参考答案？</p>
              <p className="text-xs text-ink">
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
                  className="主按钮 px-3 py-1.5 text-sm"
                >
                  确认查看（将记入进度）
                </button>
                <button
                  onClick={() => 设等待确认(false)}
                  className="次按钮 px-3 py-1.5 text-sm"
                >
                  再想想
                </button>
              </div>
            </div>
          )}
          {已借助答案 && (
            <span className="rounded-full bg-assist/10 px-2 py-0.5 text-xs font-medium text-assist">
              已借助答案
            </span>
          )}
        </div>
        {答案已展开 && (
          <pre className="overflow-auto rounded-lg border border-border-strong bg-deep p-3 font-mono text-sm">
            {参考答案}
          </pre>
        )}
      </div>
    </div>
  );
}
