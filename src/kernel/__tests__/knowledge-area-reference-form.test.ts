// 接缝：S3 kernel 纯函数（issue #83 / spec #75，ADR 0010）——资产知识点清单双形态：
// 自由字符串（现状）与词表引用（knowledgeAreaRefIds 与 knowledgeAreas 逐位对齐的
// 词表条目 id 有序数组，字段存在即引用形态）。契约解析接受双形态并校验引用数组形状；
// 读取端一律归一化（读 knowledgeAreas 名称——落库写入时已与词表对齐），两形态内核行为一致；
// 版本分类把引用数组纳入 B 类种子字段（清单内容或形态变化 → B 类，ADR 0009 分界不变）。
import { describe, expect, it } from "vitest";
import { parseDomainPackJson, assetToKernelPack, type DomainPackAsset } from "@/kernel/domain-pack-contract";
import { classifyDomainPackChange } from "@/kernel/domain-pack-versioning";
import { validateDomainPack } from "@/kernel/domain-pack-gate";
import { builtinPackAssets } from "@/domain-packs/builtin-packs";
import { generatePracticeSession } from "@/kernel/question-picking";
import { mkCloudPackJson, CLOUD_FIXTURE_KNOWLEDGE_AREAS } from "@/kernel/__tests__/fixtures/cloud-domain-pack";

/** 以内置包 A 为底本（自由字符串形态），克隆后按需注入引用形态字段 */
function baseAsset(): DomainPackAsset {
  const source = builtinPackAssets[0];
  return JSON.parse(JSON.stringify(source)) as DomainPackAsset;
}

describe("契约解析：知识点清单双形态", () => {
  it("自由字符串形态（无引用数组）：现状不变，解析通过且不产生引用字段", () => {
    const asset = baseAsset();
    const parsed = parseDomainPackJson(asset);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.pack.knowledgeAreaRefIds).toBeUndefined();
  });

  it("引用形态：与清单等长、无重复的 id 数组解析通过并随资产透传", () => {
    const asset = baseAsset();
    const refIds = asset.knowledgeAreas.map((_name, i) => `ka-${i + 1}`);
    const parsed = parseDomainPackJson({ ...asset, knowledgeAreaRefIds: refIds });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.pack.knowledgeAreaRefIds).toEqual(refIds);
  });

  it("引用形态形状校验：与清单不等长 / 含重复 / 含非字符串 → 解析拒绝并给中文错误", () => {
    const asset = baseAsset();
    const refIds = asset.knowledgeAreas.map((_name, i) => `ka-${i + 1}`);

    const short = parseDomainPackJson({ ...asset, knowledgeAreaRefIds: refIds.slice(1) });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors.some((e) => e.includes("knowledgeAreaRefIds"))).toBe(true);

    const duplicated = [...refIds];
    duplicated[1] = duplicated[0];
    const dup = parseDomainPackJson({ ...asset, knowledgeAreaRefIds: duplicated });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.some((e) => e.includes("重复"))).toBe(true);

    const badType = parseDomainPackJson({ ...asset, knowledgeAreaRefIds: [123, ...refIds.slice(1)] });
    expect(badType.ok).toBe(false);
  });
});

describe("归一化读取：两形态进入判题内核行为一致", () => {
  it("assetToKernelPack 只取名称清单（引用数组不进内核域包），同种子抽题序列完全一致", () => {
    const freeAsset = baseAsset();
    const refAsset: DomainPackAsset = {
      ...freeAsset,
      knowledgeAreaRefIds: freeAsset.knowledgeAreas.map((_name, i) => `ka-${i + 1}`),
    };
    const freePack = assetToKernelPack(freeAsset);
    const refPack = assetToKernelPack(refAsset);
    expect(refPack).toEqual(freePack);

    // 抽题（question-picking）：同种子两形态会话逐题一致——归一化后行为不变的直接证据
    const seed = 20261102;
    expect(generatePracticeSession(seed, refPack)).toEqual(generatePracticeSession(seed, freePack));
  });
});

describe("版本分类：引用数组纳入 B 类种子字段（ADR 0009 分界不变）", () => {
  it("名称与引用均不变 → unchanged；仅名称变 → B；仅引用数组变（名称不变）→ B", () => {
    const current: DomainPackAsset = {
      ...baseAsset(),
      knowledgeAreaRefIds: baseAsset().knowledgeAreas.map((_n, i) => `ka-${i + 1}`),
    };
    expect(classifyDomainPackChange(current, current)).toBe("unchanged");

    const renamed: DomainPackAsset = {
      ...current,
      knowledgeAreas: [...current.knowledgeAreas],
      templates: current.templates.map((t) =>
        t.knowledgeArea === current.knowledgeAreas[0] ? { ...t, knowledgeArea: "改名知识点" } : t,
      ),
    };
    renamed.knowledgeAreas[0] = "改名知识点";
    expect(classifyDomainPackChange(current, renamed)).toBe("B");

    const reRefed: DomainPackAsset = { ...current, knowledgeAreaRefIds: [...(current.knowledgeAreaRefIds ?? [])] };
    (reRefed.knowledgeAreaRefIds as string[])[0] = "ka-999";
    expect(classifyDomainPackChange(current, reRefed)).toBe("B");
  });

  it("形态切换（引用 → 自由，名称不变）→ B：清单存储形态变化即清单变化", () => {
    const current: DomainPackAsset = {
      ...baseAsset(),
      knowledgeAreaRefIds: baseAsset().knowledgeAreas.map((_n, i) => `ka-${i + 1}`),
    };
    const droppedToFree: DomainPackAsset = { ...current, knowledgeAreaRefIds: undefined };
    expect(classifyDomainPackChange(current, droppedToFree)).toBe("B");
    expect(classifyDomainPackChange(droppedToFree, current)).toBe("B");
  });
});

describe("验证闸门：对两形态行为一致", () => {
  it("合法引用形态过闸门（与自由形态同一夹具口径）；引用数组形状非法被结构检查拒绝", async () => {
    const freeJson = mkCloudPackJson();
    const refJson = mkCloudPackJson({
      knowledgeAreaRefIds: [...CLOUD_FIXTURE_KNOWLEDGE_AREAS].map((_name, i) => `ka-${i + 1}`),
    });
    const freeReport = await validateDomainPack(freeJson);
    const refReport = await validateDomainPack(refJson);
    expect(refReport.passed).toBe(freeReport.passed);
    expect(refReport.structural.status).toBe(freeReport.structural.status);

    // 引用数组与清单不等长：结构检查拒绝（其余部分同合法夹具，隔离出引用数组的影响）
    const badReport = await validateDomainPack(
      mkCloudPackJson({ knowledgeAreaRefIds: ["ka-1", "ka-2"] }),
    );
    expect(badReport.passed).toBe(false);
    expect(badReport.structural.status).toBe("失败");
    expect(badReport.structural.issues.some((i) => i.message.includes("knowledgeAreaRefIds"))).toBe(true);
  });
});
