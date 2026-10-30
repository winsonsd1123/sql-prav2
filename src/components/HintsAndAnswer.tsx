"use client";

// 两层提示逐层揭示 + 参考答案查看（issue #9）。
// 状态不落在本组件（随会话进度持久），只负责展示与回调。
// 外观为静室；解锁门槛见 issue #16，ADR-0003。

import { useState } from "react";

/**
 * 解锁状态包（issue #16，ADR-0003）：尝试次数门槛 + 已通过的题全解锁。
 * 四个字段同源同变，捆绑传入避免 props 松散漂移；由调用方从 进度 一次构造。
 */
export interface UnlockState {
  passed: boolean;
  hintUnlocked: boolean;
  answerUnlocked: boolean;
  attemptCount: number;
}

export interface HintsAndAnswerProps {
  hints: [string, string];
  referenceAnswer: string;
  layersSeen: number; // 0/1/2
  usedAnswer: boolean;
  unlockState: UnlockState;
  /** 距答案解锁还差的尝试次数（门槛口径归 进度 模块，0 表示已解锁） */
  attemptsToUnlock: number;
  /**
   * 参考答案豁免（T5，ADR-0003 修订 v3）：持「随时查看参考答案」权限点者
   * 免摩擦力门槛直接查看；查看属教学检视，不弹确认框、不记「借助答案」。
   */
  answerExemption?: boolean;
  onRevealHint: () => void;
  onViewAnswer: () => void;
}

export default function HintsAndAnswer({
  hints,
  referenceAnswer,
  layersSeen,
  usedAnswer,
  unlockState,
  attemptsToUnlock,
  answerExemption = false,
  onRevealHint,
  onViewAnswer,
}: HintsAndAnswerProps) {
  const [answerExpanded, setAnswerExpanded] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const { passed, hintUnlocked } = unlockState;
  // 豁免者免门槛：答案恒解锁，锁定说明不出现
  const answerUnlocked = answerExemption || unlockState.answerUnlocked;

  // 锁定态按钮直接标明解锁条件（spec 用户故事 16）；次数口径来自 进度.答案解锁还差尝试
  const hintLockHint = passed ? "" : "先验证一次解锁提示";
  const answerLockHint = passed
    ? ""
    : layersSeen >= 1
      ? `再试 ${attemptsToUnlock} 次解锁答案`
      : `再试 ${attemptsToUnlock} 次或看提示后解锁答案`;
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2" data-testid="提示与答案">
      <div className="space-y-2">
        <div className="flex flex-col items-start gap-2">
          <button
            onClick={onRevealHint}
            disabled={layersSeen >= 2 || !hintUnlocked}
            data-testid="提示按钮"
            className="次按钮 px-3 py-2 text-left text-sm disabled:opacity-40"
          >
            {layersSeen === 0
              ? "显示提示（第 1 层：思路）"
              : layersSeen === 1
                ? "再显示一层（第 2 层：关键子句）"
                : "两层提示已全部显示"}
          </button>
          {!hintUnlocked && (
            <span data-testid="提示锁定说明" className="text-xs text-muted">
              {hintLockHint}
            </span>
          )}
          {layersSeen > 0 && (
            <span className="font-mono text-xs text-muted">已看 {layersSeen}/2 层</span>
          )}
        </div>
        {layersSeen >= 1 && (
          <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm leading-relaxed">
            <strong className="text-warn">提示 1 · 思路：</strong>
            {hints[0]}
          </p>
        )}
        {layersSeen >= 2 && (
          <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm leading-relaxed">
            <strong className="text-warn">提示 2 · 关键子句：</strong>
            <code className="font-mono">{hints[1]}</code>
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-col items-start gap-2">
          <button
            onClick={() => {
              // 通过后查看仅展示不记录（语义收紧，进度原样返回，无需调用回调）；
              // 豁免查看同属展示不记录（教学检视）；通过前（无豁免）先弹确认框
              if (passed || answerExemption) {
                setAnswerExpanded(true);
              } else setAwaitingConfirm(true);
            }}
            disabled={!answerUnlocked}
            data-testid="答案按钮"
            className="次按钮 px-3 py-2 text-left text-sm disabled:opacity-40"
          >
            {answerExpanded ? "参考答案已显示" : "查看参考答案"}
          </button>
          {!answerUnlocked && (
            <span data-testid="答案锁定说明" className="text-xs text-muted">
              {answerLockHint}
            </span>
          )}
          {answerExemption && (
            <span data-testid="答案豁免说明" className="text-xs text-muted">
              教学检视：免门槛查看，不计「借助答案」
            </span>
          )}
          {awaitingConfirm && (
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
                    setAwaitingConfirm(false);
                    setAnswerExpanded(true);
                    onViewAnswer();
                  }}
                  data-testid="确认查看答案"
                  className="主按钮 px-3 py-1.5 text-sm"
                >
                  确认查看（将记入进度）
                </button>
                <button
                  onClick={() => setAwaitingConfirm(false)}
                  className="次按钮 px-3 py-1.5 text-sm"
                >
                  再想想
                </button>
              </div>
            </div>
          )}
          {usedAnswer && (
            <span className="rounded-full bg-assist/10 px-2 py-0.5 text-xs font-medium text-assist">
              已借助答案
            </span>
          )}
        </div>
        {answerExpanded && (
          <pre className="overflow-auto rounded-lg border border-border-strong bg-deep p-3 font-mono text-sm">
            {referenceAnswer}
          </pre>
        )}
      </div>
    </div>
  );
}
