"use client";

// 合并加载层的同步部分（票 #57 / spec #53 目标②，ADR-0008 后果「内置同步 + 云端异步合并」）：
// 内置域包仍是模块级同步常量（#58 迁移为云端资产前代码态为准），云端域包异步拉取后与之合并。
// 三件纯函数/常量供 session-store 与 演练场 共用。

import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";
import { loadPackB } from "@/domain-packs/employee-department-salary/pack-b";
import type { DomainPack } from "@/kernel/types";

/** 内置域包注册表：同步加载（现状不动），是异步就绪前的全部可见域包 */
export const builtinDomainPacks: DomainPack[] = [loadPackA(), loadPackB()];

/**
 * 合并注册表：内置在前、云端在后；packId 冲突时内置优先——
 * 内置迁移为云端资产（#58）完成前代码态为准，保证「同种子字节级复现」硬约束不被云端行意外覆盖。
 */
export function mergePackRegistries(
  builtin: readonly DomainPack[],
  cloud: readonly DomainPack[],
): DomainPack[] {
  const builtinIds = new Set(builtin.map((d) => d.packId));
  return [...builtin, ...cloud.filter((d) => !builtinIds.has(d.packId))];
}

/**
 * 初始 packId（延迟校验）：localStorage 里的非空字符串原样保留——
 * 云端域包 id 在云端就绪前也保住，不压回内置包A，
 * 否则进度会话键（progressKey 含 packId）短暂错位、云端同步写错行（票 #57 验收项④）。
 * 合法性判定延迟到渲染时对合并注册表查表（查不到 = 云端包未就绪 → 会话暂不生成，见 Playground）。
 */
export function pickInitialPackId(
  raw: string | null,
  builtin: readonly DomainPack[],
): string {
  if (raw !== null && raw.trim().length > 0) return raw;
  return builtin[0].packId;
}
