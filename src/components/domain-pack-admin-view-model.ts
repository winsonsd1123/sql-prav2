// 域包管理页视图模型纯函数（票 #60 / spec #53 目标②）：
// 把 LLM 草稿 JSON 与 #56 闸门 GateReport 整形为界面可直接渲染的结构。
// 刻意纯函数（无 React、无 fetch）：发布确认摘要与报告渲染的口径在这里单测锁死，
// 组件层只做展示编排（沿用本仓库「纯逻辑抽离 + 薄组件」的测试先例）。

import type { GateIssue, GateReport } from "@/kernel/domain-pack-gate";
import type { DomainPack } from "@/kernel/types";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";

/** 草稿关键信息摘要：确认发布前给教师核对的清单（GLOSSARY「难度档位」五档分布） */
export interface DomainPackDraftSummary {
  packId: string;
  name: string;
  tableCount: number;
  templateCount: number;
  /** 难度 1-5 各档模板数，五档齐全占位（缺档为 0） */
  tierCounts: Record<"1" | "2" | "3" | "4" | "5", number>;
}

/**
 * 从草稿 JSON 提取摘要：只信任结构合法的字段（LLM 草稿可能结构不完整，
 * 任何关键字段缺失/形状不对返回 null，调用方提示「草稿结构不完整」，不白屏不静默编数据）。
 */
export function buildDraftSummary(draft: unknown): DomainPackDraftSummary | null {
  if (typeof draft !== "object" || draft === null) return null;
  const d = draft as {
    packId?: unknown;
    name?: unknown;
    schemaSkeleton?: unknown;
    templates?: unknown;
  };
  if (typeof d.packId !== "string" || typeof d.name !== "string") return null;
  if (!Array.isArray(d.schemaSkeleton) || !Array.isArray(d.templates)) return null;
  const tierCounts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as DomainPackDraftSummary["tierCounts"];
  for (const template of d.templates) {
    const difficulty = (template as { difficulty?: unknown } | null)?.difficulty;
    if (typeof difficulty !== "number" || !Number.isInteger(difficulty)) continue;
    const key = String(difficulty) as keyof DomainPackDraftSummary["tierCounts"];
    if (key in tierCounts) tierCounts[key] += 1;
  }
  return {
    packId: d.packId,
    name: d.name,
    tableCount: d.schemaSkeleton.length,
    templateCount: d.templates.length,
    tierCounts,
  };
}

/** 报告单段视图模型：标题 + 三态状态 + 逐条 GateIssue + 段附注（如检查覆盖量） */
export interface GateReportSectionView {
  title: string;
  status: GateReport["structural"]["status"];
  issues: GateIssue[];
  /** 附注明细（检查覆盖量表/种子清单），空字符串 = 无附注 */
  detail: string;
}

/** 把 GateReport 的三段整形为有序视图模型（结构 → 生成 → 自判），message 原样透出（闸门产出的即人类可读中文） */
export function buildGateReportSections(report: GateReport): GateReportSectionView[] {
  return [
    {
      title: "结构检查",
      status: report.structural.status,
      issues: report.structural.issues,
      detail: `检查了 ${report.structural.checkedTables} 张表、${report.structural.checkedTemplates} 道模板`,
    },
    {
      title: "生成检查",
      status: report.generation.status,
      issues: report.generation.issues,
      detail: `测试种子 ${report.generation.seeds.join("、")}`,
    },
    {
      title: "自判检查",
      status: report.selfJudging.status,
      issues: report.selfJudging.issues,
      detail: `覆盖 ${report.selfJudging.checkedTemplates} 道模板（种子 ${report.selfJudging.seed}）`,
    },
  ];
}

/** 域包列表行：管理页「域包列表」区块的渲染口径（GLOSSARY「域包放出」状态随清单派生） */
export interface DomainPackListRow {
  packId: string;
  /** 基础名（去 @vN 后缀）：微调入口与版本历史查询的锚点（票 #62，基础名永不改） */
  basePackId: string;
  name: string;
  tableCount: number;
  templateCount: number;
  /** 难度 1-5 各档模板数概览（五档占位，缺档为 0） */
  tierOverview: Record<"1" | "2" | "3" | "4" | "5", number>;
  /** 来源：内置（随前端发布）/ 云端（含 LLM 发布） */
  source: "内置" | "云端";
  /** 是否对学生放出；清单未配置（null）时默认全放（与放出管理语义一致） */
  exposed: boolean;
}

/**
 * 域包列表行视图模型（票 #62 起输入为「已按基础名收敛为最新版」的展示清单，
 * 收敛由页面层 pickLatestVersionPerBase(mergePackRegistries(...)) 完成——
 * 内置包被 B 类微调出新版本后，列表该行即云端新版本（来源「云端」），旧版本进版本历史区块）。
 * builtinBaseIds 为内置基础名集合：无后缀且基础名命中 = 来源「内置」，否则「云端」。
 * exposedIds 传 null 表示未配置（默认全部放出）。
 */
export function buildDomainPackListRows(
  packs: readonly DomainPack[],
  builtinBaseIds: ReadonlySet<string>,
  exposedIds: ReadonlySet<string> | null,
): DomainPackListRow[] {
  return packs.map((pack) => {
    const tierOverview = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as DomainPackListRow["tierOverview"];
    for (const template of pack.templates) {
      const key = String(template.difficulty) as keyof DomainPackListRow["tierOverview"];
      if (key in tierOverview) tierOverview[key] += 1;
    }
    const { base, version } = parsePackIdVersion(pack.packId);
    const isBuiltin = version === 1 && builtinBaseIds.has(base);
    return {
      packId: pack.packId,
      basePackId: base,
      name: pack.name,
      tableCount: pack.schemaSkeleton.length,
      templateCount: pack.templates.length,
      tierOverview,
      source: isBuiltin ? ("内置" as const) : ("云端" as const),
      // 放出按基础名或完整 id 双口径（与 filterExposedPacks 一致：微调不改变放出状态）
      exposed:
        exposedIds === null ||
        exposedIds.has(pack.packId) ||
        (base !== pack.packId && exposedIds.has(base)),
    };
  });
}
