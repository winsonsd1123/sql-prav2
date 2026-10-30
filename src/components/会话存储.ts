"use client";

/**
 * 会话级本地状态（code-review #1 从演练场拆出）：
 * 种子 / 域包 / 进度 三套状态各为一个基于 创建本地存储 的外部存储，
 * 共享同一通知总线（任一写入唤醒全部订阅者——进度键由种子与域包推导，
 * 换一套或换域包后进度须立即按新键重载，等价于重置）。
 * 演练场组件只负责 UI 编排，通过 useSyncExternalStore 消费这些存储。
 */

import { 创建本地存储 } from "@/components/本地存储";
import { 空进度, 进度键, 解析进度, type 进度记录 } from "@/components/进度";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";
import { 加载域包B } from "@/domain-packs/员工部门薪资/域包B";
import type { DomainPack } from "@/kernel/types";

// 域包注册表：学生可在两个业务域之间切换练习（issue #8）
export const 域包注册表: DomainPack[] = [加载域包A(), 加载域包B()];

const 种子键 = "sql-playground:seed";
const 域包键 = "sql-playground:pack";

// 共享订阅集合：三套存储共用——任一存储写入，唤醒全部订阅者
const 订阅者 = new Set<() => void>();

/** 种子外部存储：URL 参数优先于 localStorage，均缺省则生成新种子并同步两者；
 * 客户端快照恒为 number，null 仅出现在 SSR */
export const 种子存储 = 创建本地存储<number | null>({
  取键: () => 种子键,
  初始化: (原文): number => {
    if (typeof window !== "undefined") {
      const 来自URL = new URLSearchParams(window.location.search).get("seed");
      if (来自URL && /^\d+$/.test(来自URL)) {
        const n = Number(来自URL);
        localStorage.setItem(种子键, String(n));
        return n;
      }
      if (原文 && /^\d+$/.test(原文)) return Number(原文);
    }
    // 首次进入：生成新种子，持久化并写入 URL
    const 新种子 = Math.floor(Math.random() * 1_000_000_000);
    localStorage.setItem(种子键, String(新种子));
    window.history.replaceState(null, "", `?seed=${新种子}`);
    return 新种子;
  },
  序列化: String,
  未就绪快照: null,
  订阅集合: 订阅者,
});

/** 当前域包ID外部存储：非法值回退到域包A */
export const 域包存储 = 创建本地存储<string>({
  取键: () => 域包键,
  初始化: (原文) =>
    域包注册表.some((d) => d.packId === 原文) ? 原文! : 域包注册表[0].packId,
  序列化: (v) => v,
  未就绪快照: 域包注册表[0].packId,
  订阅集合: 订阅者,
});

/** 进度外部存储：键随会话（域包+种子）派生，键变化时惰性重载，等价于换会话重置 */
export const 进度存储 = 创建本地存储<进度记录>({
  取键: () => {
    const 种子 = 种子存储.取快照();
    return 种子 === null ? null : 进度键(域包存储.取快照(), 种子);
  },
  初始化: 解析进度,
  序列化: (值) => JSON.stringify(值),
  未就绪快照: 空进度,
  订阅集合: 订阅者,
});

/** 进度迁移写回：读取当前进度 → 迁移 → 持久化并通知 */
export function 迁移进度(迁移: (p: 进度记录) => 进度记录): void {
  进度存储.写(迁移(进度存储.取快照()));
}

/** 草稿防抖保存器（issue #15）：编辑器逐键变更只在静默窗口后写一次进度，
 * 避免逐键同步写 localStorage；切题/卸载前调用 立即刷新 落盘最后一次编辑。
 * 写入函数注入以便单测（真实使用见 演练场 的 保存草稿）。 */
export function 创建草稿保存器(
  写入: (题号: number, SQL: string) => void,
  静默毫秒 = 500,
): { 排程: (题号: number, SQL: string) => void; 立即刷新: () => void } {
  let 待写: { 题号: number; SQL: string } | null = null;
  let 计时器: ReturnType<typeof setTimeout> | null = null;
  const 落盘 = () => {
    if (待写 === null) return;
    const { 题号, SQL } = 待写;
    待写 = null;
    写入(题号, SQL);
  };
  return {
    排程: (题号, SQL) => {
      待写 = { 题号, SQL };
      if (计时器 !== null) clearTimeout(计时器);
      计时器 = setTimeout(落盘, 静默毫秒);
    },
    立即刷新: () => {
      if (计时器 !== null) {
        clearTimeout(计时器);
        计时器 = null;
      }
      落盘();
    },
  };
}

/** 换一套：生成新种子（保留域包，同域包下换一套库与题），并同步 URL */
export function 换一套种子(): void {
  const 新种子 = Math.floor(Math.random() * 1_000_000_000);
  种子存储.写(新种子);
  window.history.replaceState(null, "", `?seed=${新种子}`);
}

/** 切换域包：保留种子，只换业务域（同种子下两域包生成各自的库与题） */
export function 设域包(域包ID: string): void {
  域包存储.写(域包ID);
}

/** 库实例名：随会话种子确定性派生的库展示标签（同一种子必得同名，非随机名） */
export function 实例名(种子: number): string {
  return `practice_${String(种子).padStart(9, "0").slice(-4)}`;
}
