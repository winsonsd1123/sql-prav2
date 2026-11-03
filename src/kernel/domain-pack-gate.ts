// 域包验证闸门（票 #56）：域包 JSON → 结构/生成/自判三类验证报告。
// 后续任何来源的域包（LLM 草稿、教师微调、内置包迁移）都过同一道闸门，
// 断言口径复用全量回归测试（复用 #54 的 integrity.ts 与 generate.ts，不重写）。
// 报告结构化（供教师端 #60 渲染）且可格式化为人类可读中文文本。

import { parseDomainPackJson, assetToKernelPack, type DomainPackAsset } from "./domain-pack-contract";
import { generateSession } from "./generate";
import { collectIntegrityViolations } from "./integrity";
import { openInMemoryDb, executeQuery } from "./execute";

/** 生成/自判检查使用的固定测试种子（不取当前时间、不随机，保证闸门结论可复现） */
export const GATE_TEST_SEEDS = [20260101, 42] as const;

/** 单条验证问题：检查类别 + 定位（模板标识/种子，均可缺省）+ 中文明细 */
export interface GateIssue {
  /** 检查类别（结构 / 生成 / 自判） */
  check: "结构" | "生成" | "自判";
  /** 问题所在的题目模板（结构/生成类问题通常无定位） */
  templateId?: string;
  /** 问题发生的种子（仅生成类问题） */
  seed?: number;
  /** 人类可读的问题描述 */
  message: string;
}

export interface GateSection {
  /** 通过 / 失败 / 跳过（前置检查失败时后续跳过） */
  status: "通过" | "失败" | "跳过";
  issues: GateIssue[];
}

export interface GateReport {
  /** 三类检查全部通过才为 true */
  passed: boolean;
  structural: GateSection & { checkedTables: number; checkedTemplates: number };
  generation: GateSection & { seeds: readonly number[] };
  selfJudging: GateSection & { checkedTemplates: number; seed: number };
}

/** 闸门可选校验（票 #82 / ADR 0010「圈选即封闭」）：圈选生成时传入圈选集合
 *  （归一化名称层面），产出清单必须 ⊆ 集合，越界记入结构检查报告；
 *  缺省不做封闭校验（未圈选 = 自由产出现状不变） */
export interface ValidateDomainPackOptions {
  knowledgeAreaAllowList?: string[];
}

/**
 * 验证闸门主入口（纯数据进、纯报告出，不触碰 issue/issue 外状态）：
 * 结构（契约校验）→ 生成（固定种子生成会话 + DDL 装载 + 完整性断言）→ 自判（参考答案可执行、结果非空、模板可实例化）。
 * 前置失败则后续检查标记「跳过」。
 */
export async function validateDomainPack(
  json: unknown,
  options: ValidateDomainPackOptions = {},
): Promise<GateReport> {
  // ── 一、结构检查 ──
  const structuralIssues: GateIssue[] = [];
  const parsed = parseDomainPackJson(json);
  let asset: DomainPackAsset | null = null;
  if (!parsed.ok) {
    structuralIssues.push(...parsed.errors.map((message) => ({ check: "结构" as const, message })));
  } else {
    asset = parsed.pack;
  }
  // 圈选封闭校验（票 #82）：产出清单 ⊆ 圈选集合（名称层面），越界逐项报告
  if (asset !== null && options.knowledgeAreaAllowList !== undefined) {
    const allowSet = new Set(options.knowledgeAreaAllowList);
    for (const area of asset.knowledgeAreas) {
      if (!allowSet.has(area)) {
        structuralIssues.push({
          check: "结构",
          message: `知识点「${area}」不在圈选集合内（圈选即封闭：产出清单只能取自圈选集合，请修改描述或调整圈选）`,
        });
      }
    }
  }
  const structural: GateReport["structural"] = {
    status: structuralIssues.length > 0 ? "失败" : "通过",
    issues: structuralIssues,
    checkedTables: asset?.schemaSkeleton.length ?? 0,
    checkedTemplates: asset?.templates.length ?? 0,
  };

  if (!asset || structural.status === "失败") {
    return {
      passed: false,
      structural,
      generation: { status: "跳过", issues: [], seeds: GATE_TEST_SEEDS },
      selfJudging: { status: "跳过", issues: [], checkedTemplates: 0, seed: GATE_TEST_SEEDS[0] },
    };
  }

  // ── 二、生成检查：固定测试种子生成会话成功、DDL 可在 sql.js 装载执行、完整性断言通过 ──
  const generationIssues: GateIssue[] = [];
  // 模板实例化失败发生在生成路径（generateSession 内替换占位符），
  // 但根因是模板问题（未知语义角色/缺参数），归类到自判检查报告，供逐题定位
  const instantiationIssues: GateIssue[] = [];
  const pack = assetToKernelPack(asset);
  const sessions = [];
  for (const seed of GATE_TEST_SEEDS) {
    try {
      const session = generateSession(seed, pack);
      // 完整性断言（复用 #54 integrity.ts，闸门只收集不抛错）
      const violations = collectIntegrityViolations(session.database.tables);
      for (const v of violations) {
        generationIssues.push({
          check: "生成",
          seed,
          message: `完整性断言失败：${v.kind}（${v.table}.${v.column}${"value" in v ? ` = ${v.value}` : ""}）`,
        });
      }
      // DDL 可在浏览器端引擎执行（参照 #54 测试的 openInMemoryDb 装载模式）
      const db = await openInMemoryDb(session);
      const tableNames = session.database.tables.map((t) => `'${t.tableName}'`).join(", ");
      const created = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${tableNames})`);
      db.close();
      if (created[0]?.values.length !== session.database.tables.length) {
        generationIssues.push({ check: "生成", seed, message: "DDL 装载后表数量与会话不一致" });
      }
      sessions.push({ seed, session });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/未知语义角色|未提供参数|不是关联参数|缺少子键|列名候选池不足/.test(message)) {
        instantiationIssues.push({ check: "自判", message: `模板不可实例化：${message}` });
      }
      generationIssues.push({ check: "生成", seed, message: `会话生成失败：${message}` });
    }
  }
  const generation: GateReport["generation"] = {
    status: generationIssues.length > 0 ? "失败" : "通过",
    issues: generationIssues,
    seeds: GATE_TEST_SEEDS,
  };

  // 生成失败时自判检查无法跑（会话不可得）；实例化失败已归入自判类问题逐条报出
  if (generation.status === "失败") {
    return {
      passed: false,
      structural,
      generation,
      selfJudging: {
        status: instantiationIssues.length > 0 ? "失败" : "跳过",
        issues: instantiationIssues,
        checkedTemplates: 0,
        seed: GATE_TEST_SEEDS[0],
      },
    };
  }

  // ── 三、自判检查（参照 template-self-judging 先例）：每题参考答案可执行、结果非空、模板可实例化 ──
  const selfJudgingIssues: GateIssue[] = [...instantiationIssues];
  const { seed, session } = sessions[0];
  for (const question of session.questions) {
    // 参考答案可执行 + 结果非空（一次执行覆盖两项）
    try {
      const result = await executeQuery(question.referenceAnswer, session);
      if (result.rows.length === 0) {
        selfJudgingIssues.push({
          check: "自判",
          templateId: question.templateId,
          message: `参考答案执行结果为空：${question.referenceAnswer}`,
        });
      }
    } catch (err) {
      selfJudgingIssues.push({
        check: "自判",
        templateId: question.templateId,
        message: `参考答案不可执行：${err instanceof Error ? err.message : String(err)}`,
      });
    }
    // 模板可实例化：实例化后的题面不应残留占位符（未知角色已在生成期抛错，此处兜住残余形态）
    if (/\{\{(?:table|col|param)\.[^}]+\}\}/.test(question.prompt)) {
      selfJudgingIssues.push({
        check: "自判",
        templateId: question.templateId,
        message: `题面实例化后仍残留占位符：${question.prompt}`,
      });
    }
  }
  const selfJudging: GateReport["selfJudging"] = {
    status: selfJudgingIssues.length > 0 ? "失败" : "通过",
    issues: selfJudgingIssues,
    checkedTemplates: session.questions.length,
    seed,
  };

  return { passed: structural.status === "通过" && generation.status === "通过" && selfJudging.status === "通过", structural, generation, selfJudging };
}

/** 格式化为人类可读中文报告（教师端展示与日志共用） */
export function formatGateReport(report: GateReport): string {
  const lines: string[] = [];
  lines.push(`域包验证${report.passed ? "通过" : "未通过"}`);
  lines.push(`结构检查：${report.structural.status}（表 ${report.structural.checkedTables}、模板 ${report.structural.checkedTemplates}）`);
  lines.push(`生成检查：${report.generation.status}（种子 ${report.generation.seeds.join("、")}）`);
  lines.push(`自判检查：${report.selfJudging.status}（模板 ${report.selfJudging.checkedTemplates} 道，种子 ${report.selfJudging.seed}）`);
  for (const section of [report.structural, report.generation, report.selfJudging]) {
    for (const issue of section.issues) {
      const target = [issue.templateId, issue.seed !== undefined ? `种子 ${issue.seed}` : undefined].filter(Boolean).join("，");
      lines.push(`  [${issue.check}]${target ? `（${target}）` : ""} ${issue.message}`);
    }
  }
  return lines.join("\n");
}
