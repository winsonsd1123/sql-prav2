/**
 * 本地存储工厂（code-review #1）：种子/域包/进度三套状态共享的
 * 「缓存键 + localStorage + 订阅」设施，供 useSyncExternalStore 消费。
 * - 惰性：首次取快照才读 localStorage，结果缓存（键不变不重读）；
 * - 键随会话变化：键变化时按新键惰性重载（换一套/换域包等价于重置）；
 * - 无 window（SSR）时返回未就绪快照，不触碰 localStorage；
 * - 订阅集合由多个存储共享：任一存储写入，所有订阅者（跨存储）都被唤醒，
 *   使依赖其他存储推导键的存储（如进度依赖种子与域包）及时重取快照。
 */

export interface LocalStorageOptions<T> {
  /** 当前的 localStorage 键；null 表示键未就绪（此时快照为未就绪值） */
  getKey: () => string | null;
  /** 从 localStorage 原文初始化（含解析与非法回退规则） */
  init: (raw: string | null) => T;
  /** 写入 localStorage 时的序列化 */
  serialize: (value: T) => string;
  /** SSR 或键未就绪时的快照 */
  notReadySnapshot: T;
  /** 共享订阅集合：本存储的写入会唤醒集合中所有回调（跨存储共享，见 session-store） */
  subscribers: Set<() => void>;
}

export interface LocalStorage<T> {
  getSnapshot(): T;
  write(value: T): void;
  subscribe(callback: () => void): () => void;
}

export function createLocalStorage<T>(options: LocalStorageOptions<T>): LocalStorage<T> {
  let cache: { key: string; value: T } | null = null;
  const clientKey = (): string | null =>
    typeof window === "undefined" ? null : options.getKey();
  return {
    getSnapshot(): T {
      const key = clientKey();
      if (key === null) return options.notReadySnapshot;
      if (cache === null || cache.key !== key) {
        cache = { key, value: options.init(localStorage.getItem(key)) };
      }
      return cache.value;
    },
    write(value: T): void {
      const key = clientKey();
      cache = key === null ? null : { key, value };
      if (key !== null) localStorage.setItem(key, options.serialize(value));
      options.subscribers.forEach((f) => f());
    },
    subscribe(callback: () => void): () => void {
      options.subscribers.add(callback);
      return () => options.subscribers.delete(callback);
    },
  };
}
