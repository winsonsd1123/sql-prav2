// 内置域包：JSON 数据资产形态（票 #58 / ADR-0008，迁移自 TS 骨架 + YAML 模板代码态）。
// 加载形态决策：两包以静态 JSON import 随前端同步发布——域包注册表仍是模块级同步常量
// （#57 的「内置同步 + 云端异步合并」回退策略不变，异步就绪前学生端不闪错），
// 同时同一份 JSON 经 Supabase 迁移入库 domain_pack_asset（供管理/教师端列出，
// 与 pack-a.json / pack-b.json 同源，由 builtin-pack-migration 测试防双写漂移）。
// packId 与迁移前一致（student-course-grade / employee-department-payroll），
// 同种子字节级复现由基线快照测试验收。

import packAJson from "./student-course-grades/pack-a.json";
import packBJson from "./employee-department-salary/pack-b.json";
import { parseDomainPackJson, type DomainPackAsset } from "@/kernel/domain-pack-contract";
import type { DomainPack } from "@/kernel/types";

/** 解析并强校验单个内置资产：发布产物损坏属构建级错误，直接抛出（不静默降级） */
function loadBuiltinAsset(json: unknown, label: string): DomainPackAsset {
  const parsed = parseDomainPackJson(json);
  if (!parsed.ok) throw new Error(`内置域包 ${label} 资产非法：${parsed.errors.join("；")}`);
  return parsed.pack;
}

/** 内置域包资产（契约完整形态：含知识点清单、难度档位定义、演练配置） */
export const builtinPackAssets: DomainPackAsset[] = [
  loadBuiltinAsset(packAJson, "pack-a"),
  loadBuiltinAsset(packBJson, "pack-b"),
];

/** 内置域包（判题内核形态：知识点清单随包透传供抽题消费） */
export const builtinDomainPacks: DomainPack[] = builtinPackAssets.map((asset) => ({
  packId: asset.packId,
  name: asset.name,
  schemaSkeleton: asset.schemaSkeleton,
  templates: asset.templates,
  knowledgeAreas: asset.knowledgeAreas,
}));
