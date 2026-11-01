import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import baselineJson from "./fixtures/builtin-pack-session-baseline.json";
import { parseDomainPackJson, type DomainPackAsset } from "../domain-pack-contract";
import { validateDomainPack } from "../domain-pack-gate";
import { generatePracticeSession } from "../question-picking";
import { builtinPackAssets, builtinDomainPacks } from "@/domain-packs/builtin-packs";

/**
 * 内置域包资产化迁移验收（票 #58 / ADR-0008）：
 * 1. 两包以 JSON 数据资产形态发布（静态 import，同步可得），packId 不变；
 * 2. 迁移后同种子完整会话快照与基线一致——字节级复现硬约束。
 *    基线在票 #61（难度配额抽题）按新算法重算一次：库部分不变、题目序列变为
 *    默认演练配置（10 题 1/3/3/2/1）的确定性输出，此后继续作为字节级锚点；
 * 3. 知识点顺序读域包字段（自带清单），内置两包行为与现状一致；
 * 4. 资产入库迁移与前端 JSON 同源（同一份数据，防双写漂移）；
 * 5. 代码态域包（TS 骨架与 YAML 模板文件）已删除。
 */

const baseline = baselineJson as Record<string, { seed: number; practiceSession: unknown }[]>;

describe.each(builtinPackAssets.map((a) => [a.packId, a]))("%s 资产化迁移", (_packId, asset: DomainPackAsset) => {
  it("JSON 资产过契约校验与验证闸门", async () => {
    expect(parseDomainPackJson(asset)).toEqual({ ok: true, pack: asset });
    const report = await validateDomainPack(asset);
    expect(report.passed).toBe(true);
  });

  it("同种子完整会话快照与迁移前基线一致（字节级复现）", () => {
    const pack = builtinDomainPacks.find((p) => p.packId === asset.packId)!;
    for (const { seed, practiceSession } of baseline[asset.packId]) {
      expect(JSON.stringify(generatePracticeSession(seed, pack))).toBe(JSON.stringify(practiceSession));
    }
  });

  it("知识点清单为现有七类且顺序不变（内置两包行为与现状一致）", () => {
    expect(asset.knowledgeAreas).toEqual([
      "单表查询与投影",
      "条件筛选与排序",
      "聚合与分组",
      "多表 JOIN",
      "子查询",
      "日期函数",
      "综合应用",
    ]);
  });
});

describe("知识点顺序下放域包字段", () => {
  it("抽题按域包自带清单顺序推进（清单重排后题序随之变化）", () => {
    const pack = builtinDomainPacks[0];
    const reordered = { ...pack, knowledgeAreas: [...pack.knowledgeAreas!].reverse() };
    const session = generatePracticeSession(42, reordered);
    const indices = session.questions.map((q) => reordered.knowledgeAreas!.indexOf(q.knowledgeArea));
    expect(indices.every((n) => n >= 0)).toBe(true);
    for (let i = 1; i < indices.length; i++) expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    // 重排后题目序列与原顺序不同（顺序确实由清单驱动，而非残余硬编码）
    expect(JSON.stringify(session.questions)).not.toBe(
      JSON.stringify(generatePracticeSession(42, pack).questions),
    );
  });
});

describe("入库迁移与前端 JSON 同源", () => {
  it("迁移 SQL 内嵌资产与静态 JSON 完全一致", () => {
    const sql = readFileSync("supabase/migrations/20261101000003_builtin-domain-packs.sql", "utf8");
    for (const asset of builtinPackAssets) {
      const marker = `'${asset.packId}'`;
      const packIdPos = sql.indexOf(marker);
      expect(packIdPos).toBeGreaterThanOrEqual(0);
      // pack_id 之后最近一段 '…'::jsonb 即该行资产（'' 为 SQL 转义的单引号）
      const assetMatch = sql.slice(packIdPos).match(/'((?:[^']|'')*)'::jsonb/);
      expect(assetMatch).not.toBeNull();
      const embedded = JSON.parse(assetMatch![1].replace(/''/g, "'")) as unknown;
      expect(embedded).toEqual(asset as unknown);
    }
  });
});

describe("代码态域包下线", () => {
  it("TS 骨架与 YAML 模板文件已删除", () => {
    const legacy = [
      "src/domain-packs/student-course-grades/pack-a.ts",
      "src/domain-packs/student-course-grades/templates.yaml",
      "src/domain-packs/employee-department-salary/pack-b.ts",
      "src/domain-packs/employee-department-salary/templates.yaml",
    ];
    for (const path of legacy) expect(existsSync(path), `${path} 应已删除`).toBe(false);
  });
});
