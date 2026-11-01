// 域包 JSON 契约（票 #56）：数据资产态域包的完整可序列化定义与手写校验。
// 一次定全：库骨架、名称池、题目模板、有序知识点清单、难度 1-5 档定义、演练配置。
// 后续任何来源的域包（LLM 草稿、教师微调、内置包迁移 #58）都以本契约为准，
// 序列化为纯 JSON（无函数、无代码执行），不引入新依赖。
// 校验失败产出「字段路径 + 中文问题」的人类可读错误，供闸门与教师端展示。

import type { DomainPack, TableDefinition, QuestionTemplate } from "./types";
import { topologicalTableOrder } from "./generate";

/** 难度档位定义（GLOSSARY「难度档位」）：难度 1-5 各档的含义，不参与种子生成（A 类改动） */
export interface DifficultyTierDefinition {
  /** 档位取值，固定 1-5，五档齐全 */
  level: number;
  /** 档位名称（如「入门」） */
  name: string;
  /** 该档的含义描述 */
  description: string;
  /** 代表该档位的 SQL 样例（供教师起草时对齐口径） */
  sampleSql: string;
}

/** 演练配置（GLOSSARY「演练配置」）：会话总题数 + 各难度档位的数量分布，不参与种子生成（A 类改动） */
export interface PracticeConfiguration {
  /** 每次会话的题目总数 */
  totalQuestions: number;
  /** 各档位数量分布，键为档位数字的字符串形式（"1"-"5"，JSON 对象键必为字符串） */
  tierDistribution: Record<string, number>;
}

/** 域包数据资产：一个业务场景的完整 JSON 定义（GLOSSARY「域包」） */
export interface DomainPackAsset {
  packId: string;
  name: string;
  /** 库骨架：3-5 表，结构语义与 kernel TableDefinition 一致（本身即纯 JSON） */
  schemaSkeleton: TableDefinition[];
  /** 题目模板集：25-35 道 */
  templates: QuestionTemplate[];
  /** 有序知识点清单：模板 knowledgeArea 必须取自本清单，顺序即会话推进顺序 */
  knowledgeAreas: string[];
  /** 难度 1-5 档定义：恰好五档、level 1-5 齐全 */
  difficultyTiers: DifficultyTierDefinition[];
  /** 演练配置：总题数与各档分布 */
  practiceConfig: PracticeConfiguration;
}

/** 契约约束常量：表数与模板数上下界（与内置包加载校验、共识基线一致） */
export const PACK_CONSTRAINTS = {
  minTables: 3,
  maxTables: 5,
  minTemplates: 25,
  maxTemplates: 35,
  minDifficulty: 1,
  maxDifficulty: 5,
} as const;

/**
 * 数据资产 → 判题内核域包（票 #57 加载层复用）：结构/模板字段同构；
 * 知识点清单与难度档位定义不进入种子生成路径（A 类改动，ADR-0009）。
 */
export function assetToKernelPack(asset: DomainPackAsset): DomainPack {
  return {
    packId: asset.packId,
    name: asset.name,
    schemaSkeleton: asset.schemaSkeleton,
    templates: asset.templates,
    // 知识点清单随包透传（票 #58 抽题按域包自带顺序推进）；难度档位定义与演练配置
    // 为 A 类改动（ADR-0009），不进入种子生成路径，留在资产态供教师端展示
    knowledgeAreas: asset.knowledgeAreas,
  };
}

export type ParseResult =
  | { ok: true; pack: DomainPackAsset }
  | { ok: false; errors: string[] };

const COLUMN_TYPES = ["INTEGER", "TEXT"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * 解析并校验域包 JSON：unknown → 合法资产 | 错误清单。
 * 手写逐字段校验（贴合仓库无 ORM/轻依赖风格），错误信息含字段路径与中文问题。
 */
export function parseDomainPackJson(json: unknown): ParseResult {
  const errors: string[] = [];
  const e = (path: string, message: string) => errors.push(`${path}：${message}`);

  if (!isPlainObject(json)) {
    return { ok: false, errors: ["域包必须是 JSON 对象"] };
  }

  for (const field of ["packId", "name"] as const) {
    if (!isNonEmptyString(json[field])) e(field, "必须是非空字符串");
  }
  if (!Array.isArray(json.schemaSkeleton)) e("schemaSkeleton", "必须是数组");
  if (!Array.isArray(json.templates)) e("templates", "必须是数组");
  if (!Array.isArray(json.knowledgeAreas)) e("knowledgeAreas", "必须是有序字符串数组");
  if (!Array.isArray(json.difficultyTiers)) e("difficultyTiers", "必须是数组");
  if (!isPlainObject(json.practiceConfig)) e("practiceConfig", "必须是对象");
  if (errors.length > 0) return { ok: false, errors };

  // ── 库骨架 ──
  const schema = json.schemaSkeleton as unknown[];
  if (schema.length < PACK_CONSTRAINTS.minTables || schema.length > PACK_CONSTRAINTS.maxTables) {
    e("schemaSkeleton", `表数必须为 ${PACK_CONSTRAINTS.minTables}-${PACK_CONSTRAINTS.maxTables}，实际 ${schema.length}`);
  }

  /** 校验一张表的列定义，返回该表全部列角色（含 serialKey）供引用检查 */
  const columnRolesOf = new Map<string, Set<string>>();
  const tableRoles = new Set<string>();
  schema.forEach((table, ti) => {
    const path = `schemaSkeleton[${ti}]`;
    const role = isPlainObject(table) ? table.tableRole : undefined;
    if (!isNonEmptyString(role)) {
      e(`${path}.tableRole`, "必须是非空字符串");
      return;
    }
    const tablePath = `schemaSkeleton.${role}`;
    if (tableRoles.has(role)) e(`${tablePath}`, "表语义角色重复");
    tableRoles.add(role);

    const roles = new Set<string>();
    columnRolesOf.set(role, roles);

    if (!Array.isArray((table as Record<string, unknown>).columns)) {
      e(`${tablePath}.columns`, "必须是数组");
      return;
    }
    const columns = (table as Record<string, unknown>).columns as unknown[];
    // serialKey：声明即主键；其 columnRole 不与普通列重复
    const serial = (table as Record<string, unknown>).serialKey;
    if (serial !== undefined) {
      if (!isPlainObject(serial)) {
        e(`${tablePath}.serialKey`, "必须是对象");
      } else {
        if (!isNonEmptyString(serial.columnRole)) e(`${tablePath}.serialKey.columnRole`, "必须是非空字符串");
        else roles.add(serial.columnRole);
        if (serial.columnNamePool !== undefined && !Array.isArray(serial.columnNamePool)) {
          e(`${tablePath}.serialKey.columnNamePool`, "必须是字符串数组");
        }
        if (!isFiniteNumber(serial.startValue) || !Number.isInteger(serial.startValue)) {
          e(`${tablePath}.serialKey.startValue`, "必须是整数");
        }
      }
    }

    const rowCount = (table as Record<string, unknown>).rowCount;
    if (!isFiniteNumber(rowCount) || !Number.isInteger(rowCount) || rowCount < 0) {
      e(`${tablePath}.rowCount`, "必须是非负整数");
    }
    if ((table as Record<string, unknown>).tableNamePool !== undefined && !Array.isArray((table as Record<string, unknown>).tableNamePool)) {
      e(`${tablePath}.tableNamePool`, "必须是字符串数组");
    }

    for (const [ci, column] of columns.entries()) {
      const colPath = `${tablePath}.columns[${ci}]`;
      if (!isPlainObject(column)) {
        e(colPath, "必须是对象");
        continue;
      }
      if (!isNonEmptyString(column.columnRole)) {
        e(`${colPath}.columnRole`, "必须是非空字符串");
        continue;
      }
      if (roles.has(column.columnRole)) e(`${colPath}.columnRole`, `列语义角色重复：${column.columnRole}`);
      roles.add(column.columnRole);

      if (!COLUMN_TYPES.includes(column.type as (typeof COLUMN_TYPES)[number])) {
        e(`${colPath}.type`, `类型必须为 ${COLUMN_TYPES.join(" 或 ")}，实际 ${String(column.type)}`);
      }
      if (column.columnNamePool !== undefined && !Array.isArray(column.columnNamePool)) {
        e(`${colPath}.columnNamePool`, "必须是字符串数组");
      }
      if (column.reference !== undefined) {
        if (!isPlainObject(column.reference) || !isNonEmptyString(column.reference.table) || !isNonEmptyString(column.reference.column)) {
          e(`${colPath}.reference`, "必须是 { table, column } 且均为非空字符串");
        }
      } else if (!Array.isArray(column.valuePool) || column.valuePool.length === 0 || !column.valuePool.every((v) => typeof v === "string" || typeof v === "number")) {
        e(`${colPath}.valuePool`, "非引用列必须提供非空的标量候选值数组");
      }
      if (column.nullProbability !== undefined && (!isFiniteNumber(column.nullProbability) || column.nullProbability < 0 || column.nullProbability > 1)) {
        e(`${colPath}.nullProbability`, "必须是 0-1 之间的数值");
      }
    }
  });

  // reference 指向的表/列必须存在
  schema.forEach((table) => {
    if (!isPlainObject(table) || !isNonEmptyString(table.tableRole) || !Array.isArray(table.columns)) return;
    const role = table.tableRole as string;
    for (const [ci, column] of table.columns.entries()) {
      if (!isPlainObject(column) || !isPlainObject(column.reference)) continue;
      const ref = column.reference;
      const targetRoles = columnRolesOf.get(ref.table as string);
      if (!targetRoles) {
        e(`schemaSkeleton.${role}.columns[${ci}].reference`, `引用了未定义的表：${String(ref.table)}`);
      } else if (!targetRoles.has(ref.column as string)) {
        e(`schemaSkeleton.${role}.columns[${ci}].reference`, `引用了表 ${String(ref.table)} 中不存在的列：${String(ref.column)}`);
      }
    }
  });

  // 无循环依赖：复用生成器的拓扑排序判定（#54），成环/引用不存在的表即报错
  if (errors.length === 0) {
    try {
      topologicalTableOrder(schema as TableDefinition[]);
    } catch (err) {
      e("schemaSkeleton", err instanceof Error ? err.message : String(err));
    }
  }

  // ── 题目模板 ──
  const templates = json.templates as unknown[];
  if (templates.length < PACK_CONSTRAINTS.minTemplates || templates.length > PACK_CONSTRAINTS.maxTemplates) {
    e("templates", `模板数必须为 ${PACK_CONSTRAINTS.minTemplates}-${PACK_CONSTRAINTS.maxTemplates}，实际 ${templates.length}`);
  }
  const knowledgeAreas = json.knowledgeAreas as unknown[];
  const areaSet = new Set<string>();
  for (const [ki, area] of knowledgeAreas.entries()) {
    if (!isNonEmptyString(area)) {
      e(`knowledgeAreas[${ki}]`, "必须是非空字符串");
      continue;
    }
    if (areaSet.has(area)) e(`knowledgeAreas[${ki}]`, `知识点重复：${area}`);
    areaSet.add(area);
  }
  if (knowledgeAreas.length === 0) e("knowledgeAreas", "知识点清单不能为空");

  const seenTemplateIds = new Set<string>();
  /** 各难度档位的模板计数（供演练配置配额检查） */
  const templatesByDifficulty = new Map<number, number>();
  templates.forEach((template, i) => {
    const path = `templates[${i}]`;
    if (!isPlainObject(template)) {
      e(path, "必须是对象");
      return;
    }
    const idPath = isNonEmptyString(template.templateId) ? template.templateId : path;
    if (!isNonEmptyString(template.templateId)) {
      e(`${path}.templateId`, "必须是非空字符串");
    } else if (seenTemplateIds.has(template.templateId)) {
      e(`${path}.templateId`, `模板标识重复：${template.templateId}`);
    } else {
      seenTemplateIds.add(template.templateId);
    }
    if (!isNonEmptyString(template.knowledgeArea)) {
      e(`${idPath}.knowledgeArea`, "必须是非空字符串");
    } else if (!areaSet.has(template.knowledgeArea)) {
      e(`${idPath}.knowledgeArea`, `知识点「${template.knowledgeArea}」不在包内知识点清单中`);
    }
    const d = template.difficulty;
    if (!isFiniteNumber(d) || !Number.isInteger(d) || d < PACK_CONSTRAINTS.minDifficulty || d > PACK_CONSTRAINTS.maxDifficulty) {
      e(`${idPath}.difficulty`, `难度必须为 ${PACK_CONSTRAINTS.minDifficulty}-${PACK_CONSTRAINTS.maxDifficulty} 的整数，实际 ${String(d)}`);
    } else {
      templatesByDifficulty.set(d, (templatesByDifficulty.get(d) ?? 0) + 1);
    }
    if (!isNonEmptyString(template.prompt)) e(`${idPath}.prompt`, "必须是非空字符串");
    if (!Array.isArray(template.hints) || template.hints.length !== 2 || !template.hints.every(isNonEmptyString)) {
      e(`${idPath}.hints`, "必须是恰好两条非空字符串（两层提示）");
    }
    if (!isNonEmptyString(template.referenceAnswer)) e(`${idPath}.referenceAnswer`, "必须是非空字符串");
    if (typeof template.ordered !== "boolean") e(`${idPath}.ordered`, "必须是布尔值");
    if (template.paramPool !== undefined) {
      if (!isPlainObject(template.paramPool) || !Object.values(template.paramPool).every((pool) => Array.isArray(pool) && pool.length > 0)) {
        e(`${idPath}.paramPool`, "每个参数必须提供非空候选数组");
      }
    }
  });

  // ── 难度档位定义 ──
  const tiers = json.difficultyTiers as unknown[];
  const tierLevels = new Set<number>();
  for (const [i, tier] of tiers.entries()) {
    const path = `difficultyTiers[${i}]`;
    if (!isPlainObject(tier)) {
      e(path, "必须是对象");
      continue;
    }
    if (!isFiniteNumber(tier.level) || !Number.isInteger(tier.level) || tier.level < 1 || tier.level > 5) {
      e(`${path}.level`, "难度档位 level 必须是 1-5 的整数");
    } else if (tierLevels.has(tier.level)) {
      e(`${path}.level`, `难度档位 ${tier.level} 重复定义`);
    } else {
      tierLevels.add(tier.level);
    }
    for (const field of ["name", "description", "sampleSql"] as const) {
      if (!isNonEmptyString(tier[field])) e(`${path}.${field}`, "必须是非空字符串");
    }
  }
  for (let level = 1; level <= 5; level++) {
    if (!tierLevels.has(level)) e("difficultyTiers", `难度档位固定 1-5 五档，缺少第 ${level} 档的定义`);
  }

  // ── 演练配置 ──
  const config = json.practiceConfig as Record<string, unknown>;
  const total = config.totalQuestions;
  if (!isFiniteNumber(total) || !Number.isInteger(total) || total < 1) {
    e("practiceConfig.totalQuestions", "必须是正整数");
  }
  const dist = config.tierDistribution;
  const distEntries = new Map<number, number>();
  if (!isPlainObject(dist)) {
    e("practiceConfig.tierDistribution", "必须是对象");
  } else {
    let sum = 0;
    for (const [key, value] of Object.entries(dist)) {
      if (!/^[1-5]$/.test(key)) {
        e("practiceConfig.tierDistribution", `档位键必须是 "1"-"5"，实际 ${key}`);
        continue;
      }
      if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 0) {
        e(`practiceConfig.tierDistribution.${key}`, "配额必须是非负整数");
        continue;
      }
      const level = Number(key);
      distEntries.set(level, value);
      sum += value;
      const available = templatesByDifficulty.get(level) ?? 0;
      if (value > available) {
        e("practiceConfig.tierDistribution", `第 ${level} 档配额 ${value} 超过该档模板数 ${available}`);
      }
    }
    if (isFiniteNumber(total) && Number.isInteger(total) && total >= 1 && sum !== total) {
      e("practiceConfig", `各档分布总和（${sum}）必须等于总题数（${total}）`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    pack: {
      packId: json.packId as string,
      name: json.name as string,
      schemaSkeleton: schema as TableDefinition[],
      templates: templates as QuestionTemplate[],
      knowledgeAreas: knowledgeAreas as string[],
      difficultyTiers: tiers as DifficultyTierDefinition[],
      practiceConfig: config as unknown as PracticeConfiguration,
    },
  };
}
