// 元素微调目标选中态纯函数（票 #87 / spec #76）：详情页三类元素——题目模板（多选框选）、
// 库骨架的表、知识点清单条目——共用一个「当前目标」状态。同一时刻至多一个目标：
// 跨类点选自动清空他类（与服务端 target 字段互斥校验同一语义，防定位歧义），
// 同类内点已选中项取消。纯函数无副作用，组件层接线渲染。

/** 元素微调目标：三类的判别联合；null = 未选中（分区纯只读） */
export type ElementRefineTarget =
  | { kind: "templates"; ids: string[] }
  | { kind: "table"; tableRole: string }
  | { kind: "knowledgeArea"; name: string };

/** 点选一道题目模板：未选中/他类目标 → 新框选集合起步；已框选 → 增删成员，空则回 null */
export function toggleTemplate(target: ElementRefineTarget | null, templateId: string): ElementRefineTarget | null {
  if (target?.kind !== "templates") return { kind: "templates", ids: [templateId] };
  const ids = target.ids.includes(templateId)
    ? target.ids.filter((id) => id !== templateId)
    : [...target.ids, templateId];
  return ids.length > 0 ? { kind: "templates", ids } : null;
}

/** 点选一张骨架表（单选：再点同表取消，点其他表切换） */
export function toggleTable(target: ElementRefineTarget | null, tableRole: string): ElementRefineTarget | null {
  if (target?.kind === "table" && target.tableRole === tableRole) return null;
  return { kind: "table", tableRole };
}

/** 点选一个知识点清单条目（单选：再点同条目取消） */
export function toggleKnowledgeArea(target: ElementRefineTarget | null, name: string): ElementRefineTarget | null {
  if (target?.kind === "knowledgeArea" && target.name === name) return null;
  return { kind: "knowledgeArea", name };
}

/** 微调面板目标徽标文案（类型 + 目标值 + 数量） */
export function describeElementTarget(target: ElementRefineTarget): string {
  switch (target.kind) {
    case "templates":
      return target.ids.length === 1
        ? `题目模板 ${target.ids[0]}`
        : `题目模板 × ${target.ids.length}（${target.ids.join("、")}）`;
    case "table":
      return `库骨架的表 ${target.tableRole}`;
    case "knowledgeArea":
      return `知识点清单条目 ${target.name}`;
  }
}

/** 请求体目标字段族（沿 #85 的扁平 target 命名自然演进）：
 *  单题沿用 targetTemplateId（#85 载荷契约不破）；多题发 targetTemplateIds；
 *  表 / 知识点分别发 targetTable / targetKnowledgeArea。四字段互斥由构造保证。 */
export function toRequestTarget(
  target: ElementRefineTarget,
): { targetTemplateId: string } | { targetTemplateIds: string[] } | { targetTable: string } | { targetKnowledgeArea: string } {
  switch (target.kind) {
    case "templates":
      return target.ids.length === 1
        ? { targetTemplateId: target.ids[0] }
        : { targetTemplateIds: target.ids };
    case "table":
      return { targetTable: target.tableRole };
    case "knowledgeArea":
      return { targetKnowledgeArea: target.name };
  }
}
