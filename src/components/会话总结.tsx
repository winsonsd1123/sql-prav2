// 会话总结卡（issue #19 T8，GLOSSARY「会话总结/完成分档」）：全部题目通过时
// 触发的浮层总结卡——右下滑入、免遮罩，展示三档完成分档统计与总通过数，
// 提供「再来一套」（换种子开新会话）与「回顾题目」（关闭后仍可点目录回看各题）。
// glitch 大标题是它第二处（也是 Logo 外唯一一处）用武之地（T1 视觉方案）。

export interface 会话总结Props {
  分档: { 独立完成: number; 借助提示: number; 借助答案: number };
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
      <span className="font-sans text-ink/70">{名称}</span>
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
      className="卡片 硬阴影 硬阴影-通过 总结滑入 fixed right-6 bottom-6 z-40 w-80 max-w-[calc(100vw-3rem)] rounded-none p-4"
      role="dialog"
      aria-label="会话总结"
    >
      <h2 className="glitch标题 mb-3 text-2xl">会话完成</h2>
      <p className="mb-3 font-mono text-sm text-ink/70">
        总通过 <span className="font-bold text-pass">{已完成}</span>/{总数}
      </p>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {分档项("bg-pass", "独立", 分档.独立完成, "独立")}
        {分档项("bg-accent", "提示", 分档.借助提示, "提示")}
        {分档项("bg-assist", "答案", 分档.借助答案, "答案")}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="再来一套按钮"
          onClick={on再来一套}
          className="霓虹按钮 硬阴影 硬阴影-强调 按压 rounded-none border-2 border-border-strong bg-accent px-4 py-1.5 text-sm font-bold text-bg"
        >
          再来一套
        </button>
        <button
          data-testid="回顾题目按钮"
          onClick={on关闭}
          className="卡片 硬阴影 按压 rounded-none px-4 py-1.5 text-sm font-medium"
        >
          回顾题目
        </button>
      </div>
    </section>
  );
}
