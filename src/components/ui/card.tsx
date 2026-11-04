import * as React from "react"
import { cn } from "cn"
import { Slot } from "radix-ui"

// 若依白卡：只负责外壳（底色/边框/圆角/投影），内距与布局由使用点决定。
function Card({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"

  return (
    <Comp
      data-slot="card"
      className={cn(
        "rounded-lg border border-border bg-card shadow-[var(--阴影-卡片)]",
        className
      )}
      {...props}
    />
  )
}

export { Card }
