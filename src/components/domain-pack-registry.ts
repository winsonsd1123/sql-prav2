"use client";

// 合并加载层的同步部分（票 #57 / spec #53 目标②，ADR-0008 后果「内置同步 + 云端异步合并」）：
// 内置域包是模块级同步常量（票 #58 迁移为 JSON 静态资产形态，随前端同步发布），
// 云端域包异步拉取后与之合并。三件纯函数/常量供 session-store 与 演练场 共用。

import { builtinDomainPacks } from "@/domain-packs/builtin-packs";
import type { DomainPack } from "@/kernel/types";

export { builtinDomainPacks };

/**
 * 合并注册表：内置在前、云端在后；packId 冲突时内置优先——
 * 保证「同种子字节级复现」硬约束不被云端行意外覆盖（库骨架/模板等种子生成路径以内置为准）。
 * 唯一例外（票 #61，A 类改动）：云端同 id 资产携带的演练配置覆盖内置包——
 * 演练配置不参与种子生成、即时生效不产生版本（ADR-0009），教师改配置后学生端
 * 重新加载即按新配置抽题；无配置的云端同 id 行（旧数据/未配置）不覆盖，内置默认配置继续生效。
 */
export function mergePackRegistries(
  builtin: readonly DomainPack[],
  cloud: readonly DomainPack[],
): DomainPack[] {
  const cloudById = new Map(cloud.map((d) => [d.packId, d]));
  const builtinMerged = builtin.map((d) => {
    const same = cloudById.get(d.packId);
    if (same === undefined || same.practiceConfig === undefined) return d;
    return { ...d, practiceConfig: same.practiceConfig };
  });
  const builtinIds = new Set(builtin.map((d) => d.packId));
  return [...builtinMerged, ...cloud.filter((d) => !builtinIds.has(d.packId))];
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
