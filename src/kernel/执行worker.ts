/// <reference lib="webworker" />
// 判题 Worker 入口（issue #10 / T9）：SQL 执行（建库 + 查询 + 比对）全部在本 Worker 内进行，
// 主线程只发"学生SQL + 会话 + 题目"、收"判定结果"，长查询期间 UI 保持可交互。
// 内核为纯函数设计，Worker 内直接调用，Node 测试路径不受影响。

import { 预热引擎 } from "./execute";
import { 判定 } from "./judge";
import { 结果行数上限 } from "./防护";
import type { Session, QuestionInstance, JudgeResult } from "./types";

export interface Worker请求 {
  id: number;
  学生SQL: string;
  会话: Session;
  题目: QuestionInstance;
}

export type Worker应答 =
  | { type: "就绪" }
  | { type: "结果"; id: number; 结果: JudgeResult };

const 上下文 = self as unknown as DedicatedWorkerGlobalScope;

// 启动即预热 WASM 引擎；就绪消息驱动主线程的首次加载指示
预热引擎().then(
  () => 上下文.postMessage({ type: "就绪" } satisfies Worker应答),
  (e) => {
    // 引擎加载失败也需让主线程知道（否则加载指示永不消失）；复用结果通道附空 id
    上下文.postMessage({ type: "就绪" } satisfies Worker应答);
    上下文.postMessage({
      type: "结果",
      id: -1,
      结果: { judge: "拦截", errorMessage: `数据库引擎（WASM）加载失败：${String(e)}` },
    } satisfies Worker应答);
  },
);

上下文.onmessage = async (ev: MessageEvent<Worker请求>) => {
  const { id, 学生SQL, 会话, 题目 } = ev.data;
  try {
    const 结果 = await 判定(学生SQL, 会话, 题目, 结果行数上限);
    上下文.postMessage({ type: "结果", id, 结果 } satisfies Worker应答);
  } catch (e) {
    // 内核判定不抛（错误均映射为判定结果）；此处为兜底，避免悬挂
    上下文.postMessage({
      type: "结果",
      id,
      结果: { judge: "拦截", errorMessage: `判定过程出现意外错误：${e instanceof Error ? e.message : String(e)}` },
    } satisfies Worker应答);
  }
};
