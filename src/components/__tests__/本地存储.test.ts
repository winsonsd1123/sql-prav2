import { describe, expect, it, beforeEach, vi } from "vitest";
import { 创建本地存储 } from "@/components/本地存储";

/**
 * 本地存储工厂（code-review #1）：种子/域包/进度三套
 * 「缓存键 + localStorage + 订阅」逻辑的共享设施。
 */

class 内存localStorage {
  private 映射 = new Map<string, string>();
  getItem(k: string) { return this.映射.get(k) ?? null; }
  setItem(k: string, v: string) { this.映射.set(k, v); }
  clear() { this.映射.clear(); }
}

function 装浏览器环境() {
  const 存储 = new 内存localStorage();
  (globalThis as Record<string, unknown>).window = { location: { search: "" } };
  (globalThis as Record<string, unknown>).localStorage = 存储;
  return 存储;
}

function 卸浏览器环境() {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
}

describe("创建本地存储", () => {
  beforeEach(() => { 卸浏览器环境(); });

  it("无 window 时快照为未就绪值", () => {
    const 存储 = 创建本地存储<string>({
      取键: () => "k",
      初始化: () => "x",
      序列化: (v) => v,
      未就绪快照: "未就绪",
      订阅集合: new Set(),
    });
    expect(存储.取快照()).toBe("未就绪");
  });

  it("读取走 localStorage、非法值回退初始化规则，结果缓存", () => {
    const ls = 装浏览器环境();
    ls.setItem("k", "原文");
    const 初始化 = vi.fn((原文: string | null) => (原文 === "原文" ? "解析值" : "回退值"));
    const 存储 = 创建本地存储<string>({ 取键: () => "k", 初始化, 序列化: (v) => v, 未就绪快照: "", 订阅集合: new Set() });
    expect(存储.取快照()).toBe("解析值");
    存储.取快照();
    expect(初始化).toHaveBeenCalledTimes(1); // 惰性且缓存
  });

  it("写：持久化到当前键并通知订阅者（可退订）", () => {
    const ls = 装浏览器环境();
    const 键 = "k1";
    const 存储 = 创建本地存储<number>({
      取键: () => 键,
      初始化: () => 0,
      序列化: String,
      未就绪快照: 0,
      订阅集合: new Set(),
    });
    const 回调 = vi.fn();
    const 退订 = 存储.订阅(回调);
    存储.写(7);
    expect(ls.getItem("k1")).toBe("7");
    expect(存储.取快照()).toBe(7);
    expect(回调).toHaveBeenCalled();
    退订();
    存储.写(8);
    expect(回调).toHaveBeenCalledTimes(1);
  });

  it("键变化时快照按新键惰性重载（换种子/换域包等价于重置）", () => {
    const ls = 装浏览器环境();
    ls.setItem("k:1", "旧");
    ls.setItem("k:2", "新");
    let 当前 = "k:1";
    const 存储 = 创建本地存储<string>({
      取键: () => 当前,
      初始化: (原文) => 原文 ?? "空",
      序列化: (v) => v,
      未就绪快照: "",
      订阅集合: new Set(),
    });
    expect(存储.取快照()).toBe("旧");
    当前 = "k:2";
    expect(存储.取快照()).toBe("新");
  });
});
