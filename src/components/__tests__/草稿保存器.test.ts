import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { 创建草稿保存器 } from "@/components/会话存储";

/**
 * 草稿防抖保存器（issue #15）：编辑器逐键变更只在静默窗口后写一次进度，
 * 切题/卸载前立即刷新，避免丢最后一次编辑。
 */
describe("创建草稿保存器", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("窗口内连续输入只写最后一次，不逐键写", () => {
    const 写入 = vi.fn();
    const 保存器 = 创建草稿保存器(写入, 500);
    保存器.排程(0, "S");
    保存器.排程(0, "SE");
    保存器.排程(0, "SELECT");
    expect(写入).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(写入).toHaveBeenCalledTimes(1);
    expect(写入).toHaveBeenCalledWith(0, "SELECT");
  });

  it("窗口未到再次输入则重新计时", () => {
    const 写入 = vi.fn();
    const 保存器 = 创建草稿保存器(写入, 500);
    保存器.排程(0, "A");
    vi.advanceTimersByTime(400);
    保存器.排程(0, "AB");
    vi.advanceTimersByTime(400);
    expect(写入).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(写入).toHaveBeenCalledWith(0, "AB");
  });

  it("立即刷新：切题前落盘并取消计时", () => {
    const 写入 = vi.fn();
    const 保存器 = 创建草稿保存器(写入, 500);
    保存器.排程(2, "SELECT b");
    保存器.立即刷新();
    expect(写入).toHaveBeenCalledWith(2, "SELECT b");
    vi.advanceTimersByTime(1000);
    expect(写入).toHaveBeenCalledTimes(1); // 计时已取消，不重复写
  });

  it("无待写内容时立即刷新不产生写入", () => {
    const 写入 = vi.fn();
    const 保存器 = 创建草稿保存器(写入, 500);
    保存器.立即刷新();
    expect(写入).not.toHaveBeenCalled();
  });
});
