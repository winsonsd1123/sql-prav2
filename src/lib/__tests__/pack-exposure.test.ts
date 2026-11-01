// 域包放出过滤（issue #55 / spec #53 目标③）：域包注册表 × 放出清单 → 学生可见列表。
// 接缝：filterExposedPacks 纯函数（后续票复用：注册表异步化后仍以本函数收口过滤语义）。
import { describe, expect, it } from "vitest";
import { filterExposedPacks, type ExposedPackLookup } from "@/lib/pack-exposure";
import type { DomainPack } from "@/kernel/types";

// 最小域包替身：过滤只消费 packId/name，其余字段不参与（避免与内核类型耦合过紧）
function packOf(packId: string, name: string): DomainPack {
  return { packId, name } as unknown as DomainPack;
}

const registry = [packOf("student-course-grade", "学生课程成绩"), packOf("employee-department-payroll", "员工部门薪资")];

describe("域包放出过滤（filterExposedPacks）", () => {
  it("清单未就绪（null）时默认全部放出：兼容断言——升级后现有学生无感", () => {
    expect(filterExposedPacks(registry, null)).toEqual(registry);
  });

  it("清单已配置时返回 注册表 ∩ 清单，顺序保持注册表顺序", () => {
    const lookup: ExposedPackLookup = new Set(["employee-department-payroll"]);
    const visible = filterExposedPacks(registry, lookup);
    expect(visible.map((d) => d.packId)).toEqual(["employee-department-payroll"]);
  });

  it("配置为空清单（一项不放）时学生看不到任何域包", () => {
    expect(filterExposedPacks(registry, new Set())).toEqual([]);
  });

  it("清单含注册表之外的 id 时静默忽略（清单可先行登记未上线的域包）", () => {
    const lookup: ExposedPackLookup = new Set(["student-course-grade", "future-pack"]);
    const visible = filterExposedPacks(registry, lookup);
    expect(visible.map((d) => d.packId)).toEqual(["student-course-grade"]);
  });

  it("全量放出时顺序与注册表一致", () => {
    const lookup: ExposedPackLookup = new Set(["employee-department-payroll", "student-course-grade"]);
    expect(filterExposedPacks(registry, lookup)).toEqual(registry);
  });
});
