// 域包管理页视图模型纯函数（票 #60 / spec #53 目标②）：
// 把 LLM 草稿 JSON 与 #56 闸门 GateReport 整形为界面可直接渲染的结构。
// 刻意纯函数（无 React、无 fetch）：发布确认摘要与报告渲染的口径在这里单测锁死，
// 组件层只做展示编排（沿用本仓库「纯逻辑抽离 + 薄组件」的测试先例）。

import type { GateIssue, GateReport } from "@/kernel/domain-pack-gate";
import type { DomainPack } from "@/kernel/types";

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
 * 域包列表行视图模型：内置在前、云端新增在后（与 mergePackRegistries 同序；
 * 云端与内置同 id 的行不占列表位——那是演练配置覆盖，不是新包）。
 * exposedIds 传 null 表示未配置（默认全部放出）。
 */
export function buildDomainPackListRows(
  builtin: readonly DomainPack[],
  cloud: readonly DomainPack[],
  exposedIds: ReadonlySet<string> | null,
): DomainPackListRow[] {
  const builtinIds = new Set(builtin.map((p) => p.packId));
  const packs = [...builtin, ...cloud.filter((p) => !builtinIds.has(p.packId))];
  return packs.map((pack) => {
    const tierOverview = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as DomainPackListRow["tierOverview"];
    for (const template of pack.templates) {
      const key = String(template.difficulty) as keyof DomainPackListRow["tierOverview"];
      if (key in tierOverview) tierOverview[key] += 1;
    }
    return {
      packId: pack.packId,
      name: pack.name,
      tableCount: pack.schemaSkeleton.length,
      templateCount: pack.templates.length,
      tierOverview,
      source: builtinIds.has(pack.packId) ? ("内置" as const) : ("云端" as const),
      exposed: exposedIds === null ? true : exposedIds.has(pack.packId),
    };
  });
}
