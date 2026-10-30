import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDraftSaver } from "@/components/session-store";

/**
 * 草稿防抖保存器（issue #15）：编辑器逐键变更只在静默窗口后写一次进度，
 * 切题/卸载前立即刷新，避免丢最后一次编辑。
 */
describe("创建草稿保存器", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("窗口内连续输入只写最后一次，不逐键写", () => {
    const writeFn = vi.fn();
    const saver = createDraftSaver(writeFn, 500);
    saver.schedule(0, "S");
    saver.schedule(0, "SE");
    saver.schedule(0, "SELECT");
    expect(writeFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith(0, "SELECT");
  });

  it("窗口未到再次输入则重新计时", () => {
    const writeFn = vi.fn();
    const saver = createDraftSaver(writeFn, 500);
    saver.schedule(0, "A");
    vi.advanceTimersByTime(400);
    saver.schedule(0, "AB");
    vi.advanceTimersByTime(400);
    expect(writeFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(writeFn).toHaveBeenCalledWith(0, "AB");
  });

  it("立即刷新：切题前落盘并取消计时", () => {
    const writeFn = vi.fn();
    const saver = createDraftSaver(writeFn, 500);
    saver.schedule(2, "SELECT b");
    saver.flushNow();
    expect(writeFn).toHaveBeenCalledWith(2, "SELECT b");
    vi.advanceTimersByTime(1000);
    expect(writeFn).toHaveBeenCalledTimes(1); // 计时已取消，不重复写
  });

  it("无待写内容时立即刷新不产生写入", () => {
    const writeFn = vi.fn();
    const saver = createDraftSaver(writeFn, 500);
    saver.flushNow();
    expect(writeFn).not.toHaveBeenCalled();
  });
});
