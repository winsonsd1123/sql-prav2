import * as React from "react"
import { cn } from "cn"

// 若依输入框：聚焦只换主色边框、不加 ring 光晕；错误态由 aria-invalid 驱动。
// text-muted 在本项目 = 次文色（见 globals.css @theme 注释）。

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-muted transition-[border-color] outline-none placeholder:text-[var(--色-占位)] focus:border-ring disabled:cursor-not-allowed disabled:bg-secondary disabled:text-[var(--色-占位)] aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
