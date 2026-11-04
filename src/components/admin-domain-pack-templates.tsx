"use client";

// 域包详情页「题目列表」分区（票 #81 / spec #73 子票三；#85 选中交互、#87 多题框选）：
// 全部题目模板的概要行（题面摘要 / 知识点归属 / 难度）+ 原生 details 展开完整题
// （题面 / 提示×2 / 参考答案 / 常见错误 / 参数池 / 有序性）。
// 票 #85 起传入 selection 时概要行出现「框选微调」按钮；票 #87 扩为 toggle 多选
// ——可框选一道或多道题目作元素微调目标（选中态 aria-pressed + 徽标清晰可见）；
// 微调本身由详情页的元素微调面板承接，本组件不发起任何变更请求。

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { QuestionTemplate } from "@/kernel/types";

/** 元素微调选中态扩展 props（票 #85 建框架，票 #87 扩为多题框选）：
 *  缺省不渲染选中交互（复用本组件的只读场景保持纯只读） */
export interface TemplateSelectionProps {
  /** 当前框选的微调目标题目集合（空 = 未选中） */
  selectedTemplateIds: readonly string[];
  /** 点选回调（toggle 语义：点未选加入集合、点已选移除） */
  onToggleTemplate: (templateId: string) => void;
}

/** 参数候选池展示格式化：条目间分号分隔；候选值标量直出、对象按「子键:值」圆点连接 */
export function formatParamPool(pool: Record<string, (string | number | Record<string, string>)[]>): string {
  return Object.entries(pool)
    .map(([name, candidates]) => `${name}：${candidates.map(formatCandidate).join("、")}`)
    .join("；");
}

/** 单个候选值的展示（标量直出 / 对象按「子键:值」圆点连接），供 formatParamPool 组装 */
function formatCandidate(candidate: string | number | Record<string, string>): string {
  if (typeof candidate === "object" && candidate !== null) {
    return Object.entries(candidate)
      .map(([key, value]) => `${key}:${value}`)
      .join("·");
  }
  return String(candidate);
}

/** 单题概要行 + 展开完整内容（原生 details，无 JS 状态即可用） */
function TemplateItem({
  template,
  selection,
}: {
  template: QuestionTemplate;
  /** 元素微调选中态（票 #85）；undefined = 无选中交互 */
  selection?: TemplateSelectionProps;
}) {
  const isSelected = selection?.selectedTemplateIds.includes(template.templateId) ?? false;
  return (
    <Card asChild className={`rounded-xl px-4 py-3 ${isSelected ? "border-primary ring-1 ring-primary" : "border-ink/10"}`}>
      <li data-testid={`题目卡片-${template.templateId}`}>
        <details data-testid={`题目展开-${template.templateId}`}>
          <summary
            className="cursor-pointer list-none"
            data-testid={`题目概要行-${template.templateId}`}
            aria-label={`题目概要 ${template.templateId}`}
          >
            <span className="font-medium">{template.prompt}</span>
            <span className="ml-2 text-xs text-muted">知识点：{template.knowledgeArea}</span>
            <span className="ml-2 text-xs text-muted">难度：{template.difficulty}</span>
            {selection && (
              <Button
                type="button"
                variant={isSelected ? "default" : "outline"}
                size="xs"
                className="ml-2 rounded-full"
                data-testid={`题目选中按钮-${template.templateId}`}
                aria-pressed={isSelected}
                onClick={(e) => {
                  // 阻止 summary 折叠切换：选中按钮只承担选中态
                  e.preventDefault();
                  selection.onToggleTemplate(template.templateId);
                }}
              >
                {isSelected ? "已框选（微调目标）" : "框选微调"}
              </Button>
            )}
          </summary>
          <div className="mt-2 flex flex-col gap-1 text-sm" data-testid={`题目完整内容-${template.templateId}`}>
            <p>
              <span className="text-muted">题面：</span>
              <span className="font-mono">{template.prompt}</span>
            </p>
            <p>
              <span className="text-muted">提示一：</span>
              {template.hints[0]}
            </p>
            <p>
              <span className="text-muted">提示二：</span>
              {template.hints[1]}
            </p>
            <p>
              <span className="text-muted">参考答案：</span>
              <span className="font-mono">{template.referenceAnswer}</span>
            </p>
            {/* 常见错误为可选字段，缺省不渲染该行 */}
            {template.commonMistake && (
              <p>
                <span className="text-muted">常见错误：</span>
                <span className="font-mono">{template.commonMistake}</span>
              </p>
            )}
            {/* 参数池为可选字段，缺省不渲染该行 */}
            {template.paramPool && (
              <p>
                <span className="text-muted">参数池：</span>
                {formatParamPool(template.paramPool)}
              </p>
            )}
            <p>
              <span className="text-muted">有序性：</span>
              {template.ordered ? "行序敏感（含 ORDER BY）" : "行序不敏感"}
            </p>
          </div>
        </details>
      </li>
    </Card>
  );
}

/** 题目列表分区：概要行覆盖包内全部模板 */
export default function AdminDomainPackTemplates({
  templates,
  selection,
}: {
  templates: QuestionTemplate[];
  /** 元素微调选中态（票 #85）：传入即启用概要行选中交互 */
  selection?: TemplateSelectionProps;
}) {
  return (
    <section id="题目列表" className="flex flex-col gap-3" data-testid="题目列表分区" aria-label="题目列表">
      <h2 className="标题 text-base">题目列表</h2>
      <p className="text-xs text-muted">
        全部题目模板（{templates.length} 题）：概要行含题面摘要、知识点归属与难度，点开查看完整题目内容。
        {selection ? "可框选一道或多道题目作为元素微调目标（改动一律经微调闭环，无手工行内编辑）。" : "严格只读。"}
      </p>
      <ul className="flex flex-col gap-2">
        {templates.map((template) => (
          <TemplateItem key={template.templateId} template={template} selection={selection} />
        ))}
      </ul>
    </section>
  );
}
