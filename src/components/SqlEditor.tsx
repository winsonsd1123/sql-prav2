"use client";

// CodeMirror 6 SQL 编辑器（issue #9）：语法高亮、行号、Ctrl/Cmd+Enter 提交、中文占位符。
// 手写薄封装（而非引第三方 React 包装）以精确控制受控值与快捷键接缝。

import { useEffect, useRef } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { sql, SQLite } from "@codemirror/lang-sql";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import type { TableInstance } from "@/kernel/types";

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd + Enter 提交（验证） */
  onSubmit: () => void;
  /** 库实例：注入 SQL 补全 schema（表名/列名） */
  tables: TableInstance[];
  disabled?: boolean;
  /** 粘贴/拖入被拦截时回调（issue #17 T6：用于编辑器上方横幅提示） */
  onInterceptPaste?: () => void;
}

/** CodeMirror 需要的 schema 形态：表名 → 列名数组 */
export function buildSchema(tables: TableInstance[]): Record<string, string[]> {
  return Object.fromEntries(tables.map((t) => [t.tableName, t.columnNames]));
}

export default function SqlEditor({ value, onChange, onSubmit, tables, disabled, onInterceptPaste }: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const submitCallbackRef = useRef(onSubmit);
  const valueRef = useRef(value);
  const interceptCallbackRef = useRef(onInterceptPaste);
  useEffect(() => {
    submitCallbackRef.current = onSubmit;
    valueRef.current = value;
    interceptCallbackRef.current = onInterceptPaste;
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      sql({ dialect: SQLite, schema: buildSchema(tables) }),
      // 表名/列名补全兜底（issue #17 T6）：禁粘贴强制手打，schema 补全必须实际可用
      autocompletion(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      cmPlaceholder("在此输入单条 SELECT 语句……"),
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
              submitCallbackRef.current();
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
          interceptCallbackRef.current?.();
          return true;
        },
        drop: () => {
          interceptCallbackRef.current?.();
          return true;
        },
      }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const text = update.state.doc.toString();
          if (text !== valueRef.current) onChange(text);
        }
      }),
    ];
    const viewInstance = new EditorView({
      state: EditorState.create({ doc: value, extensions: extensions }),
      parent: containerRef.current,
    });
    viewRef.current = viewInstance;
    return () => {
      viewInstance.destroy();
      viewRef.current = null;
    };
    // 编辑器实例只创建一次；值与表的变化由下方同步 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 受控同步：外部值变化（如切题清空）时写回文档
  useEffect(() => {
    const instance = viewRef.current;
    if (instance && value !== instance.state.doc.toString()) {
      instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      aria-label="SQL 编辑器"
      className={`overflow-hidden bg-panel ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    />
  );
}
