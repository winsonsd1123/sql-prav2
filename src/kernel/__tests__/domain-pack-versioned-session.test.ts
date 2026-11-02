// 会话级集成测试（票 #62 / ADR-0009）：B 类微调产生新版本后——
// 进行中会话（旧 packId）的题目序列与微调前逐题一致（钉旧版）、进度/草稿键按 packId 隔离；
// 新会话（新 packId）用新版本内容。零迁移：不依赖任何数据搬迁。
import { describe, expect, it } from "vitest";
import { mkCloudPackJson } from "./fixtures/cloud-domain-pack";
import { parseDomainPackJson, assetToKernelPack, type DomainPackAsset } from "@/kernel/domain-pack-contract";
import { generatePracticeSession } from "@/kernel/question-picking";
import { progressKey } from "@/components/progress";
import { findSessionPack } from "@/components/domain-pack-registry";
import type { DomainPack } from "@/kernel/types";

const SEED = 20261101;

describe("B 类微调后的会话语义（进行中会话钉旧版本，ADR-0009）", () => {
  // 夹具恒合法：窄化为 ok 分支取 pack（夹具非法在此测试毫无意义，窄化失败即该行抛错）
  const v1Asset = (parseDomainPackJson(mkCloudPackJson({ packId: "library-loan" })) as { ok: true; pack: DomainPackAsset })
    .pack;
  // B 类改动：全部模板题面微调（参与种子生成的内容变；抽题只取部分模板，
  // 改单道可能恰好不在选中集，故全量改保证新旧会话题面可分辨）
  const v2Asset = {
    ...v1Asset,
    packId: "library-loan@v2",
    templates: v1Asset.templates.map((t: DomainPackAsset["templates"][number]) => ({ ...t, prompt: `${t.prompt}（微调）` })),
  };

  // 加载层三源：内置（此处空）+ 云端当前（v2）+ 云端历史（v1）
  const builtin: DomainPack[] = [];
  const cloud = [assetToKernelPack(v2Asset)];
  const history = [assetToKernelPack(v1Asset)];

  it("旧 packId 会话的题目序列与微调前逐题一致（钉旧版不错乱）", () => {
    const before = generatePracticeSession(SEED, assetToKernelPack(v1Asset));
    const pack = findSessionPack(builtin, cloud, history, "library-loan");
    expect(pack).not.toBeNull();
    const after = generatePracticeSession(SEED, pack!);
    expect(after.questions.map((q) => q.prompt)).toEqual(before.questions.map((q) => q.prompt));
  });

  it("新 packId（@v2）会话使用新版本内容：题面序列与旧版不同", () => {
    const oldSession = generatePracticeSession(SEED, assetToKernelPack(v1Asset));
    const newSession = generatePracticeSession(SEED, assetToKernelPack(v2Asset));
    expect(newSession.questions.map((q) => q.prompt)).not.toEqual(oldSession.questions.map((q) => q.prompt));
  });

  it("进度/草稿会话键含 packId 文本：新旧版本自动隔离，零迁移", () => {
    expect(progressKey("library-loan", SEED)).not.toBe(progressKey("library-loan@v2", SEED));
    expect(progressKey("library-loan", SEED)).toBe(`sql-playground:progress:library-loan:${SEED}`);
  });

  it("历史版本不可得（如历史表读取失败）时旧 packId 解析为 null——会话暂不生成而非错配新版本", () => {
    expect(findSessionPack(builtin, cloud, [], "library-loan")).toBeNull();
  });
});
