import { describe, expect, it, beforeEach, vi } from "vitest";
import { createLocalStorage } from "@/components/local-storage";

/**
 * 本地存储工厂（code-review #1）：种子/域包/进度三套
 * 「缓存键 + localStorage + 订阅」逻辑的共享设施。
 */

class MemoryLocalStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  clear() { this.map.clear(); }
}

function installBrowserEnv() {
  const store = new MemoryLocalStorage();
  (globalThis as Record<string, unknown>).window = { location: { search: "" } };
  (globalThis as Record<string, unknown>).localStorage = store;
  return store;
}

function uninstallBrowserEnv() {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
}

describe("创建本地存储", () => {
  beforeEach(() => { uninstallBrowserEnv(); });

  it("无 window 时快照为未就绪值", () => {
    const store = createLocalStorage<string>({
      getKey: () => "k",
      init: () => "x",
      serialize: (v) => v,
      notReadySnapshot: "未就绪",
      subscribers: new Set(),
    });
    expect(store.getSnapshot()).toBe("未就绪");
  });

  it("读取走 localStorage、非法值回退初始化规则，结果缓存", () => {
    const ls = installBrowserEnv();
    ls.setItem("k", "原文");
    const initFn = vi.fn((raw: string | null) => (raw === "原文" ? "解析值" : "回退值"));
    const store = createLocalStorage<string>({ getKey: () => "k", init: initFn, serialize: (v) => v, notReadySnapshot: "", subscribers: new Set() });
    expect(store.getSnapshot()).toBe("解析值");
    store.getSnapshot();
    expect(initFn).toHaveBeenCalledTimes(1); // 惰性且缓存
  });

  it("写：持久化到当前键并通知订阅者（可退订）", () => {
    const ls = installBrowserEnv();
    const key = "k1";
    const store = createLocalStorage<number>({
      getKey: () => key,
      init: () => 0,
      serialize: String,
      notReadySnapshot: 0,
      subscribers: new Set(),
    });
    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);
    store.write(7);
    expect(ls.getItem("k1")).toBe("7");
    expect(store.getSnapshot()).toBe(7);
    expect(callback).toHaveBeenCalled();
    unsubscribe();
    store.write(8);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("键变化时快照按新键惰性重载（换种子/换域包等价于重置）", () => {
    const ls = installBrowserEnv();
    ls.setItem("k:1", "旧");
    ls.setItem("k:2", "新");
    let current = "k:1";
    const store = createLocalStorage<string>({
      getKey: () => current,
      init: (raw) => raw ?? "空",
      serialize: (v) => v,
      notReadySnapshot: "",
      subscribers: new Set(),
    });
    expect(store.getSnapshot()).toBe("旧");
    current = "k:2";
    expect(store.getSnapshot()).toBe("新");
  });
});
