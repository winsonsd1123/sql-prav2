"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"
import { cn } from "cn"

// #107 引入 shadcn 风格 tooltip 封装：底层走 radix-ui 统一包原语（已在依赖，零新增外部包，
// ADR-0012）。用于侧栏折叠 rail 态的菜单名 / 品牌名提示；配色走 sidebar 主题 token。
// shadcn add 方式拉入的 registry 版本附带 button 依赖且样式体系不同，故按本仓 token 手写同构封装。

function TooltipProvider({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />
}

function Tooltip({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  // 每个 Tooltip 自带 Provider（默认 300ms 出提示）：radix 共享 Provider 下
  // 连续悬停切换 trigger 不重开（实测踩坑），独立 Provider 各自开合互不阻塞。
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <TooltipPrimitive.Root data-slot="tooltip" delayDuration={delayDuration} {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit rounded-md border border-sidebar-divider bg-sidebar px-2.5 py-1.5 text-xs text-sidebar-bright shadow-sidebar",
          "data-[state=closed]:hidden data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
