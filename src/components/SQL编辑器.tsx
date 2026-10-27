"use client";

// CodeMirror 6 SQL 编辑器（issue #9）：语法高亮、行号、Ctrl/Cmd+Enter 提交、中文占位符。
// 手写薄封装（而非引第三方 React 包装）以精确控制受控值与快捷键接缝。

import { useEffect, useRef } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder as cm占位,
} from "@codemirror/view";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { sql, SQLite } from "@codemirror/lang-sql";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import type { 表实例 } from "@/kernel/types";

export interface SQL编辑器属性 {
  值: string;
  onChange: (值: string) => void;
  /** Ctrl/Cmd + Enter 提交（验证） */
  onSubmit: () => void;
  /** 库实例：注入 SQL 补全 schema（表名/列名） */
  表: 表实例[];
  禁用?: boolean;
  /** 粘贴/拖入被拦截时回调（issue #17 T6：用于编辑器上方横幅提示） */
  on拦截粘贴?: () => void;
}

/** CodeMirror 需要的 schema 形态：表名 → 列名数组 */
export function 构造schema(表: 表实例[]): Record<string, string[]> {
  return Object.fromEntries(表.map((t) => [t.表名, t.列名]));
}

export default function SQL编辑器({ 值, onChange, onSubmit, 表, 禁用, on拦截粘贴 }: SQL编辑器属性) {
  const 容器 = useRef<HTMLDivElement>(null);
  const 视图 = useRef<EditorView | null>(null);
  const 提交回调 = useRef(onSubmit);
  const 值引用 = useRef(值);
  const 拦截回调 = useRef(on拦截粘贴);
  useEffect(() => {
    提交回调.current = onSubmit;
    值引用.current = 值;
    拦截回调.current = on拦截粘贴;
  });

  useEffect(() => {
    if (!容器.current) return;
    const 扩展: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      sql({ dialect: SQLite, schema: 构造schema(表) }),
      // 表名/列名补全兜底（issue #17 T6）：禁粘贴强制手打，schema 补全必须实际可用
      autocompletion(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      cm占位("在此输入单条 SELECT 语句……"),
      EditorView.lineWrapping,
      // 颜色走语义 token，随亮暗主题切换。扩展结构与受控同步不动。
      EditorView.theme({
        "&": {
          fontSize: "14px",
          minHeight: "168px",
          backgroundColor: "var(--色-面板, #fff)",
          color: "var(--色-墨, #111)",
        },
        ".cm-content": {
          fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
          padding: "8px 0",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          color: "var(--色-次文)",
          border: "none",
        },
        ".cm-placeholder": {
          color: "var(--色-次文)",
        },
        ".cm-activeLine": {
          backgroundColor: "color-mix(in srgb, var(--色-墨, #111) 4%, transparent)",
        },
        ".cm-activeLineGutter": { backgroundColor: "transparent" },
        "&.cm-focused": {
          outline: "1px solid color-mix(in srgb, var(--色-墨, #111) 18%, transparent)",
        },
      }),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              提交回调.current();
              return true;
            },
          },
        ]),
      ),
      // 禁粘贴与拖入（issue #17 T6，ADR-0003 摩擦力设计）：
      // 在 DOM 事件层拦截 paste 与 drop 并返回 true 阻止默认行为，
      // 覆盖键盘 Cmd/Ctrl+V、右键粘贴与拖放文本；无任何例外通道。
      EditorView.domEventHandlers({
        paste: () => {
          拦截回调.current?.();
          return true;
        },
        drop: () => {
          拦截回调.current?.();
          return true;
        },
      }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((更新) => {
        if (更新.docChanged) {
          const 文本 = 更新.state.doc.toString();
          if (文本 !== 值引用.current) onChange(文本);
        }
      }),
    ];
    const 视图实例 = new EditorView({
      state: EditorState.create({ doc: 值, extensions: 扩展 }),
      parent: 容器.current,
    });
    视图.current = 视图实例;
    return () => {
      视图实例.destroy();
      视图.current = null;
    };
    // 编辑器实例只创建一次；值与表的变化由下方同步 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 受控同步：外部值变化（如切题清空）时写回文档
  useEffect(() => {
    const 实例 = 视图.current;
    if (实例 && 值 !== 实例.state.doc.toString()) {
      实例.dispatch({ changes: { from: 0, to: 实例.state.doc.length, insert: 值 } });
    }
  }, [值]);

  return (
    <div
      ref={容器}
      aria-label="SQL 编辑器"
      className={`overflow-hidden bg-panel ${
        禁用 ? "pointer-events-none opacity-50" : ""
      }`}
    />
  );
}
