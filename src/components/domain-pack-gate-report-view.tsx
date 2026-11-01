"use client";

// 验证报告渲染（code-review 修复 B / Standards #2）：生成与微调两条业务流共享的报告子形状，
// 从 admin-domain-pack-generator.tsx 提出为独立组件（此前微调区块跨文件借调生成区块的导出）。
// 三段状态 + 逐条 GateIssue，与放出/配置区块同款卡片样式；样式与结构两处共用，文案归各调用方语境。

import { buildGateReportSections } from "@/components/domain-pack-admin-view-model";
import type { GateReport } from "@/kernel/domain-pack-gate";

/** 报告渲染：三段状态 + 逐条 GateIssue（与放出/配置区块同款卡片样式） */
export function GateReportView({ report }: { report: GateReport }) {
  const sections = buildGateReportSections(report);
  return (
    <div data-testid="验证报告" className="flex flex-col gap-2">
      <p className={report.passed ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-red-700"}>
        {report.passed ? "验证通过：可确认发布" : "验证未通过：请根据以下明细修改后重试"}
      </p>
      {sections.map((section) => (
        <div key={section.title} className="rounded-lg border border-ink/10 px-3 py-2">
          <p className="flex items-center gap-2 text-sm">
            <span className="font-medium">{section.title}</span>
            <span
              className={
                section.status === "通过"
                  ? "text-emerald-700"
                  : section.status === "失败"
                    ? "text-red-700"
                    : "text-muted"
              }
            >
              {section.status}
            </span>
            <span className="text-xs text-muted">{section.detail}</span>
          </p>
          {section.issues.length > 0 && (
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-xs text-red-700">
              {section.issues.map((issue, i) => (
                <li key={i} data-testid={`验证报告问题-${i}`}>
                  {issue.templateId !== undefined && <span className="font-mono">[{issue.templateId}] </span>}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
