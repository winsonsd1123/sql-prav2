// 版本轻量 diff 纯函数单测（票 #88 / spec #77）：两版本资产 → diff 视图模型——
// 增/删/改区块识别（表 / 知识点 / 题目模板粒度）、A/B 类结论透传（复用版本分类器）、
// 知识点清单双形态（引用 / 旧字符串）对比。不做逐字段高亮（spec #77 范围外）。
import { describe, expect, it } from "vitest";
import { buildDomainPackDiffView } from "@/kernel/domain-pack-diff";
import type { DomainPackAsset } from "@/kernel/domain-pack-contract";
import { mkCloudPackJson, CLOUD_FIXTURE_KNOWLEDGE_AREAS } from "./fixtures/cloud-domain-pack";

/** 以云端夹具为底，按需覆写字段构造资产 */
function mkAsset(overrides: Partial<DomainPackAsset>): DomainPackAsset {
  const base = mkCloudPackJson({ packId: "diff-test-pack" });
  return { ...base, ...overrides } as DomainPackAsset;
}

describe("buildDomainPackDiffView：区块增删改识别", () => {
  it("完全相同：无区块、结论 unchanged", () => {
    const view = buildDomainPackDiffView(mkAsset({}), mkAsset({}));
    expect(view.changeClass).toBe("unchanged");
    expect(view.blocks).toEqual([]);
  });

  it("表增 / 删 / 改各识别为一个区块（按 tableRole 归位）", () => {
    const base = mkAsset({});
    const schema = base.schemaSkeleton.slice();
    // 改：第 0 张表行数变化；删：第 1 张（课程）
    schema[0] = { ...schema[0], rowCount: (schema[0].rowCount ?? 20) + 5 } as typeof schema[0];
    schema.splice(1, 1);
    const after = mkAsset({ schemaSkeleton: schema });
    const view = buildDomainPackDiffView(base, after);
    const tableBlocks = view.blocks.filter((b) => b.section === "table");
    expect(tableBlocks.map((b) => [b.key, b.action])).toEqual(
      expect.arrayContaining([
        ["学生", "modified"],
        ["课程", "removed"],
      ]),
    );
    // 模板引用了被删的表，但模板本身未变 → 不产生模板区块（区块粒度按资产字段，不做引用推导）
    expect(view.blocks.filter((b) => b.section === "template")).toEqual([]);
    expect(view.changeClass).toBe("B");
  });

  it("题目模板增 / 删 / 改各识别为一个区块（按 templateId 归位）", () => {
    const base = mkAsset({});
    const templates = base.templates.slice();
    // 改：第 0 道题面变化；删：第 1 道
    templates[0] = { ...templates[0], prompt: "改后的题面。" } as typeof templates[0];
    templates.splice(1, 1);
    // 增：一道新模板（字段形状与夹具一致）
    templates.push({
      ...templates[0],
      templateId: "cloud-tpl-new",
    } as typeof templates[0]);
    const view = buildDomainPackDiffView(base, mkAsset({ templates }));
    expect(view.blocks.filter((b) => b.section === "template").map((b) => [b.key, b.action])).toEqual(
      expect.arrayContaining([
        ["cloud-tpl-01", "modified"],
        ["cloud-tpl-02", "removed"],
        ["cloud-tpl-new", "added"],
      ]),
    );
    expect(view.changeClass).toBe("B");
  });

  it("知识点清单增 / 删识别为区块；同集合重排识别为顺序调整", () => {
    const base = mkAsset({});
    // 增 + 删
    const swapped = [...CLOUD_FIXTURE_KNOWLEDGE_AREAS.slice(0, 6), "新增知识点"];
    const addRemove = buildDomainPackDiffView(base, mkAsset({ knowledgeAreas: swapped }));
    expect(addRemove.blocks.filter((b) => b.section === "knowledgeArea").map((b) => [b.key, b.action])).toEqual(
      expect.arrayContaining([
        ["综合应用", "removed"],
        ["新增知识点", "added"],
      ]),
    );
    // 同集合重排：无增删区块，产出单个「顺序调整」modified 区块（知识点序参与抽题分区，ADR-0009）
    const reordered = [...CLOUD_FIXTURE_KNOWLEDGE_AREAS.slice(0, 6)].reverse().concat(
      CLOUD_FIXTURE_KNOWLEDGE_AREAS[6],
    );
    const reorder = buildDomainPackDiffView(base, mkAsset({ knowledgeAreas: reordered }));
    const blocks = reorder.blocks.filter((b) => b.section === "knowledgeArea");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].action).toBe("modified");
    expect(blocks[0].key).toContain("顺序");
  });

  it("仅 A 类字段变（演练配置）：无种子区块，结论透传 A", () => {
    const base = mkAsset({});
    const after = mkAsset({
      practiceConfig: { totalQuestions: 8, tierDistribution: { "1": 2, "2": 2, "3": 2, "4": 1, "5": 1 } },
    });
    const view = buildDomainPackDiffView(base, after);
    expect(view.blocks).toEqual([]);
    expect(view.changeClass).toBe("A");
  });
});

describe("buildDomainPackDiffView：知识点清单双形态对比（#83 / ADR 0010）", () => {
  const freeForm = mkAsset({});
  const refForm = mkAsset({
    knowledgeAreaRefIds: CLOUD_FIXTURE_KNOWLEDGE_AREAS.map((_, i) => `ka-${i}`),
  });

  it("名称清单一致 + 形态切换（自由 ↔ 引用）：识别为清单变更区块，结论透传 B", () => {
    const view = buildDomainPackDiffView(freeForm, refForm);
    const blocks = view.blocks.filter((b) => b.section === "knowledgeArea");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].action).toBe("modified");
    expect(blocks[0].key).toContain("形态");
    expect(view.changeClass).toBe("B");
  });

  it("引用形态下名称变化（换圈选条目）：按名称识别增删区块（归一化名称层面对比）", () => {
    const refBefore = mkAsset({
      knowledgeAreas: ["甲", "乙", "丙"],
      knowledgeAreaRefIds: ["ka-1", "ka-2", "ka-3"],
    });
    // 乙 换成 丁（名称与 id 都变）：表现为名称层面的一删一增
    const refAfter = mkAsset({
      knowledgeAreas: ["甲", "丁", "丙"],
      knowledgeAreaRefIds: ["ka-1", "ka-4", "ka-3"],
      templates: refBefore.templates.map((t) =>
        t.knowledgeArea === "乙" ? ({ ...t, knowledgeArea: "丁" } as typeof t) : t,
      ),
    });
    const view = buildDomainPackDiffView(refBefore, refAfter);
    expect(view.blocks.filter((b) => b.section === "knowledgeArea").map((b) => [b.key, b.action])).toEqual(
      expect.arrayContaining([
        ["乙", "removed"],
        ["丁", "added"],
      ]),
    );
    expect(view.changeClass).toBe("B");
  });
});
