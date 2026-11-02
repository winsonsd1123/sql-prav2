import { describe, expect, it } from "vitest";
import { formatParamPool } from "@/components/admin-domain-pack-templates";

// 题目模板参数池的展示格式化（票 #81）：详情页展开完整题时渲染参数候选池。
// 期望值取自内置包真实数据（student-course-grades/pack-a.json），独立事实源而非复算。

describe("formatParamPool", () => {
  it("标量候选池：参数名 + 候选值顿号连接", () => {
    expect(formatParamPool({ 及格线: [60, 70, 80] })).toBe("及格线：60、70、80");
  });

  it("字符串候选池同样顿号连接", () => {
    expect(formatParamPool({ 城市: ["北京", "上海"] })).toBe("城市：北京、上海");
  });

  it("对象候选池（关联参数）：每个候选按「子键:值」圆点连接，候选间顿号分隔", () => {
    expect(
      formatParamPool({
        排序方向: [
          { 描述: "从高到低", SQL: "DESC" },
          { 描述: "从低到高", SQL: "ASC" },
        ],
      }),
    ).toBe("排序方向：描述:从高到低·SQL:DESC、描述:从低到高·SQL:ASC");
  });

  it("多参数条目间用分号分隔", () => {
    expect(formatParamPool({ 线: [85, 90], 名额: [3, 5] })).toBe("线：85、90；名额：3、5");
  });

  it("空对象返回空字符串（无参数池的模板不渲染该行）", () => {
    expect(formatParamPool({})).toBe("");
  });
});
