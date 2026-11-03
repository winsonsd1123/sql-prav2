// 接缝：元素微调目标选中态纯函数（票 #87 / spec #76）——三类元素（题目模板多选框选 /
// 库骨架表 / 知识点清单条目）共用一个「当前目标」状态：跨类切换自动清空他类（同时
// 只有一个微调目标，防定位歧义），同类内点已选中项取消。纯函数无副作用，组件层接线。
import { describe, expect, it } from "vitest";
import {
  toggleTemplate,
  toggleTable,
  toggleKnowledgeArea,
  describeElementTarget,
  toRequestTarget,
} from "@/components/element-refine-target";

describe("toggleTemplate：多题框选", () => {
  it("未选中时点题目：进入框选目标（单元素起步）", () => {
    expect(toggleTemplate(null, "tpl-a")).toEqual({ kind: "templates", ids: ["tpl-a"] });
  });

  it("框选追加：已框选集合内点新题目 → 集合增长，顺序按点选先后", () => {
    const target = toggleTemplate(toggleTemplate(null, "tpl-a"), "tpl-b");
    expect(target).toEqual({ kind: "templates", ids: ["tpl-a", "tpl-b"] });
  });

  it("再点已框选题目：从集合移除；集合空则回到未选中", () => {
    const one = toggleTemplate({ kind: "templates", ids: ["tpl-a", "tpl-b"] }, "tpl-a");
    expect(one).toEqual({ kind: "templates", ids: ["tpl-b"] });
    expect(toggleTemplate(one, "tpl-b")).toBeNull();
  });

  it("当前目标是表/知识点时点题目：跨类切换，清空他类目标", () => {
    expect(toggleTemplate({ kind: "table", tableRole: "学生" }, "tpl-a")).toEqual({
      kind: "templates",
      ids: ["tpl-a"],
    });
  });
});

describe("toggleTable / toggleKnowledgeArea：单选目标", () => {
  it("点表进入表目标；再点同表取消；点其他表切换", () => {
    const on = toggleTable(null, "成绩");
    expect(on).toEqual({ kind: "table", tableRole: "成绩" });
    expect(toggleTable(on, "成绩")).toBeNull();
    expect(toggleTable(on, "学生")).toEqual({ kind: "table", tableRole: "学生" });
  });

  it("点知识点条目进入知识点目标；再点同条目取消", () => {
    const on = toggleKnowledgeArea(null, "聚合与分组");
    expect(on).toEqual({ kind: "knowledgeArea", name: "聚合与分组" });
    expect(toggleKnowledgeArea(on, "聚合与分组")).toBeNull();
  });

  it("表/知识点互为跨类切换，也清空框选集合", () => {
    expect(toggleKnowledgeArea({ kind: "templates", ids: ["tpl-a"] }, "子查询")).toEqual({
      kind: "knowledgeArea",
      name: "子查询",
    });
    expect(toggleTable({ kind: "knowledgeArea", name: "子查询" }, "课程")).toEqual({
      kind: "table",
      tableRole: "课程",
    });
  });
});

describe("describeElementTarget：微调面板徽标文案", () => {
  it("单题与多题分别点名标识数量", () => {
    expect(describeElementTarget({ kind: "templates", ids: ["tpl-a"] })).toContain("tpl-a");
    expect(describeElementTarget({ kind: "templates", ids: ["tpl-a", "tpl-b"] })).toContain("× 2");
  });

  it("表与知识点各点名类型与值", () => {
    expect(describeElementTarget({ kind: "table", tableRole: "成绩" })).toContain("成绩");
    expect(describeElementTarget({ kind: "table", tableRole: "成绩" })).toContain("表");
    expect(describeElementTarget({ kind: "knowledgeArea", name: "子查询" })).toContain("子查询");
    expect(describeElementTarget({ kind: "knowledgeArea", name: "子查询" })).toContain("知识点");
  });
});

describe("toRequestTarget：请求体目标字段族（沿 #85 的扁平 target 命名）", () => {
  it("单题沿用 targetTemplateId（#85 载荷契约不破）", () => {
    expect(toRequestTarget({ kind: "templates", ids: ["tpl-a"] })).toEqual({ targetTemplateId: "tpl-a" });
  });

  it("多题发 targetTemplateIds 数组", () => {
    expect(toRequestTarget({ kind: "templates", ids: ["tpl-a", "tpl-b"] })).toEqual({
      targetTemplateIds: ["tpl-a", "tpl-b"],
    });
  });

  it("表与知识点分别发 targetTable / targetKnowledgeArea", () => {
    expect(toRequestTarget({ kind: "table", tableRole: "成绩" })).toEqual({ targetTable: "成绩" });
    expect(toRequestTarget({ kind: "knowledgeArea", name: "子查询" })).toEqual({
      targetKnowledgeArea: "子查询",
    });
  });
});
