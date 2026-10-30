// 会话总结卡：全部题目通过时居中出现，免遮罩。
// 展示三档完成分档与总通过数，可再来一套或关闭后回顾题目。

export interface SessionSummaryProps {
  tiers: { independent: number; withHints: number; withAnswer: number };
  completed: number;
  total: number;
  onPlayAgain: () => void;
  onClose: () => void;
}

/** 三档图例项：语义色小方块 + 档名 + 等宽数字（独立=pass / 提示=accent / 答案=assist） */
function tierItem(colorClass: string, name: string, count: number, key: string) {
  return (
    <span
      key={key}
      data-testid={`分档-${key}`}
      className="flex items-center gap-1.5 font-mono text-sm"
    >
      <i className={`h-3 w-3 border border-border-strong ${colorClass}`} aria-hidden />
      <span className="font-sans text-muted">{name}</span>
      <span className="font-bold text-ink">{count}</span>
    </span>
  );
}

export default function SessionSummary({
  tiers,
  completed,
  total,
  onPlayAgain,
  onClose,
}: SessionSummaryProps) {
  return (
    <section
      data-testid="会话总结卡"
      className="卡片 居中浮现 fixed top-1/2 left-1/2 z-40 w-[22rem] max-w-[calc(100vw-2rem)] p-6"
      role="dialog"
      aria-label="会话总结"
    >
      <h2 className="标题 mb-3 text-[1.75rem] leading-none">会话完成</h2>
      <p className="mb-3 font-mono text-sm text-muted">
        总通过 <span className="font-bold text-pass">{completed}</span>/{total}
      </p>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {tierItem("bg-pass", "独立", tiers.independent, "独立")}
        {tierItem("bg-warn", "提示", tiers.withHints, "提示")}
        {tierItem("bg-assist", "答案", tiers.withAnswer, "答案")}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="再来一套按钮"
          onClick={onPlayAgain}
          className="主按钮 px-4 py-2 text-sm"
        >
          再来一套
        </button>
        <button
          data-testid="回顾题目按钮"
          onClick={onClose}
          className="次按钮 px-4 py-2 text-sm"
        >
          回顾题目
        </button>
      </div>
    </section>
  );
}
