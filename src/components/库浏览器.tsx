"use client";

// 库浏览器浮层（issue #9 侧栏 → issue #14 T3 免遮罩浮层）：默认隐藏，由顶栏
// 「库」按钮 / Cmd/Ctrl+B 唤出（开关状态归 演练场 持有）；fixed 左侧滑入、实底色
// + 硬阴影 + 粗描边、无遮罩层；点击浮层外任意处（含编辑器）或按 ESC 收起。
// 每张表仍为 <details> 可折叠，展示表名、列（名+类型）与数据预览表格。

import { useEffect, useRef } from "react";
import type { 表实例 } from "@/kernel/types";

export default function LibraryBrowser({
  表,
  实例名,
  打开,
  on关闭,
}: {
  表: 表实例[];
  实例名: string;
  打开: boolean;
  on关闭: () => void;
}) {
  const 浮层引用 = useRef<HTMLElement>(null);

  // 点外收起：mousedown 在浮层外（含编辑器）即关闭；顶栏「库」开关按钮自身除外
  //（否则 mousedown 关闭 + click 再切换会相互抵消）。
  useEffect(() => {
    if (!打开) return;
    function 在外按下(e: MouseEvent) {
      const 目标 = e.target as Node | null;
      if (!目标) return;
      if (浮层引用.current?.contains(目标)) return;
      if (目标 instanceof Element && 目标.closest("[data-库浏览器开关]")) return;
      on关闭();
    }
    document.addEventListener("mousedown", 在外按下);
    return () => document.removeEventListener("mousedown", 在外按下);
  }, [打开, on关闭]);

  // 挂载保活（spec 故事 31）：关闭只置 hidden 不卸载，表级 <details> 折叠状态得以保留；
  // display:none → 可见的切换会让 浮层滑入 动画重新播放，开合动效不受影响。
  return (
    <aside
      ref={浮层引用}
      hidden={!打开}
      data-testid="库浏览器浮层"
      aria-label="库浏览器"
      aria-hidden={!打开}
      // 免遮罩浮层：fixed 左侧滑入（动画类 浮层滑入 见 globals.css）；无任何遮罩层
      className="浮层滑入 卡片 硬阴影 fixed top-4 bottom-4 left-4 z-40 w-80 max-w-[85vw] overflow-y-auto rounded-none p-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">
          库浏览器 <span className="font-mono text-xs font-normal text-ink/50">（实例：{实例名}）</span>
        </h2>
        <button onClick={on关闭} className="卡片 按压 rounded-none px-2 py-0.5 text-xs text-ink/60">
          收起
        </button>
      </div>
      <div className="space-y-2">
        {表.map((表实例) => (
          <details
            key={表实例.表名}
            className="卡片 rounded-none"
            data-testid="库表"
            data-表名={表实例.表名}
            open
          >
            <summary className="cursor-pointer border-b-2 border-dashed border-ink/20 px-3 py-2 font-mono text-sm font-semibold">
              {表实例.表名}（{表实例.行.length} 行）
            </summary>
            <div className="space-y-2 px-3 pb-2 pt-2 text-xs text-ink/70">
              <ul className="space-y-0.5">
                {表实例.列名.map((列, i) => (
                  <li key={列} className="font-mono">
                    {列} <span className="text-ink/40">{表实例.类型[i]}</span>
                  </li>
                ))}
              </ul>
              <div className="max-h-64 overflow-auto border-2 border-ink/20">
                <table className="w-full font-mono">
                  <thead className="sticky top-0 bg-ink/10">
                    <tr>
                      {表实例.列名.map((列) => (
                        <th key={列} className="px-2 py-1 text-left font-semibold whitespace-nowrap">
                          {列}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {表实例.行.map((行, i) => (
                      <tr key={i} className="border-t border-ink/10">
                        {行.map((值, j) => (
                          <td key={j} className="px-2 py-1 whitespace-nowrap">
                            {值 === null ? <em className="text-ink/40">NULL</em> : String(值)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}
