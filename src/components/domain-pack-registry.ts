"use client";

// 合并加载层的同步部分（票 #57 / spec #53 目标②，ADR-0008 后果「内置同步 + 云端异步合并」）：
// 内置域包是模块级同步常量（票 #58 迁移为 JSON 静态资产形态，随前端同步发布），
// 云端域包异步拉取后与之合并。三件纯函数/常量供 session-store 与 演练场 共用。

import { builtinDomainPacks } from "@/domain-packs/builtin-packs";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";
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

/**
 * 每个基础名只保留最高版本（票 #62 / ADR-0009）：供展示用注册表（学生端切换胶囊、
 * 管理页列表）收敛为「每个域包一行 = 当前最新版本」；被取代的旧版本仍留在
 * 全量清单里供 findSessionPack 解析（进行中会话钉旧版本）。
 */
export function pickLatestVersionPerBase(packs: readonly DomainPack[]): DomainPack[] {
  const latest = new Map<string, DomainPack>();
  for (const pack of packs) {
    const { base, version } = parsePackIdVersion(pack.packId);
    const existing = latest.get(base);
    if (existing === undefined) {
      latest.set(base, pack);
      continue;
    }
    const existingVersion = parsePackIdVersion(existing.packId).version;
    if (version > existingVersion) latest.set(base, pack);
  }
  return [...latest.values()];
}

/**
 * 会话域包解析（票 #62：进行中会话钉旧版本）：按学生当前 packId 在
 * 内置静态资产 → 云端当前版本 → 云端历史版本 中查表。
 * 旧 packId（v1）落到历史版本内容——题目序列与进度/草稿键（含 packId 文本）
 * 与新版本天然隔离，零迁移（ADR-0009）；查无此包返回 null（会话暂不生成，#57 策略）。
 */
export function findSessionPack(
  builtin: readonly DomainPack[],
  cloud: readonly DomainPack[],
  history: readonly DomainPack[],
  packId: string,
): DomainPack | null {
  return (
    builtin.find((d) => d.packId === packId) ??
    cloud.find((d) => d.packId === packId) ??
    history.find((d) => d.packId === packId) ??
    null
  );
}
