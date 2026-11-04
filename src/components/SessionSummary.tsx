// 会话总结弹窗：全部题目通过时居中出现（shadcn Dialog：Portal、焦点陷阱、Esc 关闭、背景滚动锁定）。
// 展示三档完成分档与总通过数，可再来一套或关闭后回顾题目。
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface SessionSummaryProps {
  open: boolean;
  tiers: { independent: number; withHints: number; withAnswer: number };
  completed: number;
  total: number;
  onPlayAgain: () => void;
  onClose: () => void;
  /** 弹窗由事件触发而非 DialogTrigger，Radix 无触发元素可还焦点，关闭后焦点交给此元素 */
  returnFocusRef: RefObject<HTMLElement | null>;
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
  open,
  tiers,
  completed,
  total,
  onPlayAgain,
  onClose,
  returnFocusRef,
}: SessionSummaryProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid="会话总结卡"
        showCloseButton={false}
        className="w-[22rem] gap-0 p-6 sm:max-w-[22rem]"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogTitle className="标题 mb-3 text-[1.75rem] leading-none">会话完成</DialogTitle>
        <DialogDescription className="mb-3 font-mono text-sm text-muted">
          总通过 <span className="font-bold text-pass">{completed}</span>/{total}
        </DialogDescription>
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
          {tierItem("bg-pass", "独立", tiers.independent, "独立")}
          {tierItem("bg-warn", "提示", tiers.withHints, "提示")}
          {tierItem("bg-assist", "答案", tiers.withAnswer, "答案")}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button data-testid="再来一套按钮" onClick={onPlayAgain} size="lg" className="px-4">
            再来一套
          </Button>
          <Button data-testid="回顾题目按钮" onClick={onClose} variant="outline" size="lg" className="px-4">
            回顾题目
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
