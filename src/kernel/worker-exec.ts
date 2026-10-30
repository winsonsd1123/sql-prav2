/// <reference lib="webworker" />
// 判题 Worker 入口（issue #10 / T9）：SQL 执行（建库 + 查询 + 比对）全部在本 Worker 内进行，
// 主线程只发"学生SQL + 会话 + 题目"、收"判定结果"，长查询期间 UI 保持可交互。
// 内核为纯函数设计，Worker 内直接调用，Node 测试路径不受影响。

import { warmUpEngine } from "./execute";
import { judge } from "./judge";
import { RESULT_ROW_LIMIT } from "./guard";
import type { Session, QuestionInstance, JudgeResult } from "./types";

export interface WorkerRequest {
  id: number;
  studentSql: string;
  session: Session;
  question: QuestionInstance;
}

export type WorkerResponse =
  | { type: "就绪" }
  | { type: "结果"; id: number; result: JudgeResult };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// 启动即预热 WASM 引擎；就绪消息驱动主线程的首次加载指示
warmUpEngine().then(
  () => ctx.postMessage({ type: "就绪" } satisfies WorkerResponse),
  (e) => {
    // 引擎加载失败也需让主线程知道（否则加载指示永不消失）；复用结果通道附空 id
    ctx.postMessage({ type: "就绪" } satisfies WorkerResponse);
    ctx.postMessage({
      type: "结果",
      id: -1,
      result: { judge: "拦截", errorMessage: `数据库引擎（WASM）加载失败：${String(e)}` },
    } satisfies WorkerResponse);
  },
);

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const { id, studentSql, session, question } = ev.data;
  try {
    const result = await judge(studentSql, session, question, RESULT_ROW_LIMIT);
    ctx.postMessage({ type: "结果", id, result } satisfies WorkerResponse);
  } catch (e) {
    // 内核判定不抛（错误均映射为判定结果）；此处为兜底，避免悬挂
    ctx.postMessage({
      type: "结果",
      id,
      result: { judge: "拦截", errorMessage: `判定过程出现意外错误：${e instanceof Error ? e.message : String(e)}` },
    } satisfies WorkerResponse);
  }
};
