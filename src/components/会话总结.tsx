// 会话总结卡：全部题目通过时居中出现，免遮罩。
// 展示三档完成分档与总通过数，可再来一套或关闭后回顾题目。

export interface 会话总结Props {
  分档: { independent: number; withHints: number; withAnswer: number };
  已完成: number;
  总数: number;
  on再来一套: () => void;
  on关闭: () => void;
}

/** 三档图例项：语义色小方块 + 档名 + 等宽数字（独立=pass / 提示=accent / 答案=assist） */
function 分档项(色类: string, 名称: string, 数量: number, 键: string) {
  return (
    <span
      key={键}
      data-testid={`分档-${键}`}
      className="flex items-center gap-1.5 font-mono text-sm"
    >
      <i className={`h-3 w-3 border border-border-strong ${色类}`} aria-hidden />
      <span className="font-sans text-muted">{名称}</span>
      <span className="font-bold text-ink">{数量}</span>
    </span>
  );
}

export default function 会话总结({
  分档,
  已完成,
  总数,
  on再来一套,
  on关闭,
}: 会话总结Props) {
  return (
    <section
      data-testid="会话总结卡"
      className="卡片 居中浮现 fixed top-1/2 left-1/2 z-40 w-[22rem] max-w-[calc(100vw-2rem)] p-6"
      role="dialog"
      aria-label="会话总结"
    >
      <h2 className="标题 mb-3 text-[1.75rem] leading-none">会话完成</h2>
      <p className="mb-3 font-mono text-sm text-muted">
        总通过 <span className="font-bold text-pass">{已完成}</span>/{总数}
      </p>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {分档项("bg-pass", "独立", 分档.independent, "独立")}
        {分档项("bg-warn", "提示", 分档.withHints, "提示")}
        {分档项("bg-assist", "答案", 分档.withAnswer, "答案")}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="再来一套按钮"
          onClick={on再来一套}
          className="主按钮 px-4 py-2 text-sm"
        >
          再来一套
        </button>
        <button
          data-testid="回顾题目按钮"
          onClick={on关闭}
          className="次按钮 px-4 py-2 text-sm"
        >
          回顾题目
        </button>
      </div>
    </section>
  );
}
