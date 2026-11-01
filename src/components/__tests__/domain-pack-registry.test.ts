// 接缝：合并加载层的纯函数部分（票 #57）——内置 + 云端合并去重、初始 packId 的延迟校验。
import { describe, expect, it } from "vitest";
import {
  builtinDomainPacks,
  mergePackRegistries,
  pickInitialPackId,
} from "@/components/domain-pack-registry";
import type { DomainPack } from "@/kernel/types";

function mkPack(packId: string): DomainPack {
  return { packId, name: packId, schemaSkeleton: [], templates: [] };
}

describe("合并注册表 mergePackRegistries", () => {
  it("内置在前、云端在后；云端就绪前（空清单）= 仅内置两包", () => {
    expect(mergePackRegistries(builtinDomainPacks, [])).toEqual(builtinDomainPacks);
    const merged = mergePackRegistries(builtinDomainPacks, [mkPack("cloud-x")]);
    expect(merged.map((d) => d.packId)).toEqual([
      "student-course-grade",
      "employee-department-payroll",
      "cloud-x",
    ]);
  });

  it("packId 冲突时内置包优先（内置迁移为云端资产 #58 完成前，代码态为准保证字节级复现）", () => {
    const merged = mergePackRegistries(builtinDomainPacks, [
      mkPack("student-course-grade"),
      mkPack("cloud-x"),
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toBe(builtinDomainPacks[0]);
  });

  it("云端同 id 资产只覆盖内置包的演练配置：内容仍以内置为准，配置即时生效（#61，A 类改动）", () => {
    const overridden: DomainPack = {
      ...builtinDomainPacks[0],
      templates: [], // 云端行即使被篡改也不得影响内置模板（种子生成路径不可漂移）
      practiceConfig: { totalQuestions: 7, tierDistribution: { "1": 1, "2": 2, "3": 2, "4": 1, "5": 1 } },
    };
    const merged = mergePackRegistries(builtinDomainPacks, [overridden]);
    expect(merged).toHaveLength(2);
    const builtin = merged[0];
    expect(builtin.templates).toBe(builtinDomainPacks[0].templates);
    expect(builtin.practiceConfig).toEqual(overridden.practiceConfig);
    // 原内置常量不被原地修改（模块级共享数组）
    expect(builtinDomainPacks[0].practiceConfig).toEqual({
      totalQuestions: 10,
      tierDistribution: { "1": 1, "2": 3, "3": 3, "4": 2, "5": 1 },
    });
  });
});

describe("初始 packId 选择 pickInitialPackId（延迟校验）", () => {
  it("非空字符串原样保留：云端包 id 在云端就绪前也保住，不被压回内置包A（进度会话键不错位）", () => {
    expect(pickInitialPackId("cloud-fixture-pack", builtinDomainPacks)).toBe("cloud-fixture-pack");
  });

  it("缺失/空串/空白回退内置包A", () => {
    expect(pickInitialPackId(null, builtinDomainPacks)).toBe("student-course-grade");
    expect(pickInitialPackId("", builtinDomainPacks)).toBe("student-course-grade");
    expect(pickInitialPackId("  ", builtinDomainPacks)).toBe("student-course-grade");
  });
});
