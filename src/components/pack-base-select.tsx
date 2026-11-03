"use client";

// 域包基础名下拉（票 #97）：微调与版本历史共用。值域与原生 select 等价——
// 空串表示停在「请选择域包」占位项，且占位项可被选回；Radix 禁止空串作选项值，
// 故占位项以哨兵值承载，进出组件时与空串互转。

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PLACEHOLDER_VALUE = "__placeholder__";

export interface PackBaseSelectProps {
  /** 触发器 data-testid（e2e 定位） */
  testId: string;
  options: readonly { base: string; name: string }[];
  /** 选中的基础名；空串 = 占位项 */
  value: string;
  onValueChange: (base: string) => void;
  disabled?: boolean;
  className?: string;
}

export function PackBaseSelect({ testId, options, value, onValueChange, disabled, className }: PackBaseSelectProps) {
  return (
    <Select
      value={value === "" ? PLACEHOLDER_VALUE : value}
      onValueChange={(next) => onValueChange(next === PLACEHOLDER_VALUE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger data-testid={testId} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={PLACEHOLDER_VALUE}>请选择域包</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.base} value={o.base}>
            {o.name}（{o.base}）
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
