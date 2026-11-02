// 域包版本化纯函数单测（票 #62 / ADR-0009）：packId 版本后缀解析与构造、
// A/B 类改动分类（参与种子生成的内容变 = B 类；仅难度档位定义/演练配置等变 = A 类）。
import { describe, expect, it } from "vitest";
import {
  parsePackIdVersion,
  buildVersionedPackId,
  classifyDomainPackChange,
} from "@/kernel/domain-pack-versioning";
import type { DomainPackAsset } from "@/kernel/domain-pack-contract";
import { mkCloudPackJson } from "./fixtures/cloud-domain-pack";

describe("parsePackIdVersion：packId 版本后缀解析", () => {
  it("无后缀 id 解析为基础名 + 版本 1（首发即 v1，后缀缺省）", () => {
    expect(parsePackIdVersion("student-course-grade")).toEqual({
      base: "student-course-grade",
      version: 1,
    });
  });

  it("带 @vN 后缀解析为基础名 + 版本 N", () => {
    expect(parsePackIdVersion("library-loan@v3")).toEqual({ base: "library-loan", version: 3 });
  });

  it("非法后缀（非 vN 形式）不视为版本后缀，整体作为基础名", () => {
    expect(parsePackIdVersion("pack@v2x")).toEqual({ base: "pack@v2x", version: 1 });
    expect(parsePackIdVersion("pack@v0")).toEqual({ base: "pack@v0", version: 1 });
    expect(parsePackIdVersion("pack@va")).toEqual({ base: "pack@va", version: 1 });
  });
});

describe("buildVersionedPackId：构造带后缀 id", () => {
  it("版本 1 不加后缀（首发 packId 即基础名，ADR-0009 基础名永不改）", () => {
    expect(buildVersionedPackId("library-loan", 1)).toBe("library-loan");
  });

  it("版本 ≥2 加 @vN 后缀", () => {
    expect(buildVersionedPackId("library-loan", 2)).toBe("library-loan@v2");
  });
});

/** 以夹具为底，按需覆写字段构造资产 */
function mkAsset(overrides: Partial<DomainPackAsset>): DomainPackAsset {
  const base = mkCloudPackJson({ packId: "version-test-pack" });
  return { ...base, ...overrides } as DomainPackAsset;
}

describe("classifyDomainPackChange：A/B 类改动分类（ADR-0009）", () => {
  const current = mkAsset({});

  it("完全相同：unchanged（无需确认版本语义）", () => {
    expect(classifyDomainPackChange(current, mkAsset({}))).toBe("unchanged");
  });

  it("仅演练配置变：A 类（即时生效，不产生版本）", () => {
    const draft = mkAsset({
      practiceConfig: { totalQuestions: 8, tierDistribution: { "1": 2, "2": 2, "3": 2, "4": 1, "5": 1 } },
    });
    expect(classifyDomainPackChange(current, draft)).toBe("A");
  });

  it("仅难度档位定义变：A 类", () => {
    const tiers = current.difficultyTiers.map((t) => ({ ...t, description: `${t.description}（修订）` }));
    expect(classifyDomainPackChange(current, mkAsset({ difficultyTiers: tiers }))).toBe("A");
  });

  it("仅场景名变：A 类（不参与种子生成）", () => {
    expect(classifyDomainPackChange(current, mkAsset({ name: "图书馆-修订名" }))).toBe("A");
  });

  it("演练配置 + 难度档位同时变（A 类字段任意组合）：A 类", () => {
    const draft = mkAsset({
      practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } },
      name: "新场景名",
    });
    expect(classifyDomainPackChange(current, draft)).toBe("A");
  });

  it("题目模板变（任一字段）：B 类", () => {
    const templates = current.templates.map((t, i) => (i === 0 ? { ...t, prompt: `${t.prompt}（微调）` } : t));
    expect(classifyDomainPackChange(current, mkAsset({ templates }))).toBe("B");
  });

  it("库骨架变（名称池取值）：B 类", () => {
    const schemaSkeleton = current.schemaSkeleton.map((table, i) =>
      i === 0 ? { ...table, rowCount: table.rowCount + 1 } : table,
    );
    expect(classifyDomainPackChange(current, mkAsset({ schemaSkeleton }))).toBe("B");
  });

  it("知识点清单变（顺序或内容都影响抽题分区）：B 类", () => {
    const knowledgeAreas = [...current.knowledgeAreas].reverse();
    expect(classifyDomainPackChange(current, mkAsset({ knowledgeAreas }))).toBe("B");
  });

  it("A 类字段与 B 类字段同时变：B 类（按更严的一类归类）", () => {
    const draft = mkAsset({
      name: "新场景名",
      templates: current.templates.map((t, i) => (i === 0 ? { ...t, difficulty: 5 } : t)),
    });
    expect(classifyDomainPackChange(current, draft)).toBe("B");
  });

  it("字段值相同但键序不同（LLM 重排 JSON 键序）：unchanged（比较走稳定序列化）", () => {
    // 递归反转每个对象的键序（值不变），模拟 LLM 输出重排键序
    const reorderKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorderKeys);
      if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).reverse().map(([k, v]) => [k, reorderKeys(v)]),
        );
      }
      return value;
    };
    const reordered = reorderKeys(current) as DomainPackAsset;
    expect(classifyDomainPackChange(current, reordered)).toBe("unchanged");
  });
});
