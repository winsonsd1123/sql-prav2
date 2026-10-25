/**
 * 本地存储工厂（code-review #1）：种子/域包/进度三套状态共享的
 * 「缓存键 + localStorage + 订阅」设施，供 useSyncExternalStore 消费。
 * - 惰性：首次取快照才读 localStorage，结果缓存（键不变不重读）；
 * - 键随会话变化：键变化时按新键惰性重载（换一套/换域包等价于重置）；
 * - 无 window（SSR）时返回未就绪快照，不触碰 localStorage；
 * - 订阅集合由多个存储共享：任一存储写入，所有订阅者（跨存储）都被唤醒，
 *   使依赖其他存储推导键的存储（如进度依赖种子与域包）及时重取快照。
 */

export interface 本地存储配置<T> {
  /** 当前的 localStorage 键；null 表示键未就绪（此时快照为未就绪值） */
  取键: () => string | null;
  /** 从 localStorage 原文初始化（含解析与非法回退规则） */
  初始化: (原文: string | null) => T;
  /** 写入 localStorage 时的序列化 */
  序列化: (值: T) => string;
  /** SSR 或键未就绪时的快照 */
  未就绪快照: T;
  /** 共享订阅集合：本存储的写入会唤醒集合中所有回调（跨存储共享，见 会话存储） */
  订阅集合: Set<() => void>;
}

export interface 本地存储<T> {
  取快照(): T;
  写(值: T): void;
  订阅(回调: () => void): () => void;
}

export function 创建本地存储<T>(配置: 本地存储配置<T>): 本地存储<T> {
  let 缓存: { 键: string; 值: T } | null = null;
  const 客户端键 = (): string | null =>
    typeof window === "undefined" ? null : 配置.取键();
  return {
    取快照(): T {
      const 键 = 客户端键();
      if (键 === null) return 配置.未就绪快照;
      if (缓存 === null || 缓存.键 !== 键) {
        缓存 = { 键, 值: 配置.初始化(localStorage.getItem(键)) };
      }
      return 缓存.值;
    },
    写(值: T): void {
      const 键 = 客户端键();
      缓存 = 键 === null ? null : { 键, 值 };
      if (键 !== null) localStorage.setItem(键, 配置.序列化(值));
      配置.订阅集合.forEach((f) => f());
    },
    订阅(回调: () => void): () => void {
      配置.订阅集合.add(回调);
      return () => 配置.订阅集合.delete(回调);
    },
  };
}
