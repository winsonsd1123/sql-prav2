// 判题 Worker 的主线程客户端（issue #10 / T9）。
// 职责：懒创建 Worker、跟踪引擎就绪态（首次 WASM 加载指示）、请求-应答配对、
// 超时兜底——sql.js 在 Worker 中同步执行无法中途取消，超时的唯一可靠手段是
// terminate() 整个 Worker（主线程与 UI 不受影响），下次请求前重建 Worker 并等待其重新就绪。

import type { Session, QuestionInstance, JudgeResult } from "./types";
import { EXECUTION_TIMEOUT_MS, GuardLimitError, ENV_ERROR_MESSAGE } from "./guard";
import type { WorkerRequest, WorkerResponse } from "./worker-exec";

interface PendingRequest {
  resolve: (r: JudgeResult) => void;
  reject: (e: GuardLimitError) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let readyFlag = false;
const readyWaiters = new Set<() => void>();
let nextId = 1;
const pending = new Map<number, PendingRequest>();
const engineReadySubscribers = new Set<() => void>();

/** 单次判题超时；可用 URL 参数 timeoutMs 覆盖（100-60000，供 e2e 构造慢查询场景） */
function currentTimeoutMs(): number {
  if (typeof window !== "undefined") {
    const override = new URLSearchParams(window.location.search).get("timeoutMs");
    if (override && /^\d+$/.test(override)) {
      const n = Number(override);
      if (n >= 100 && n <= 60_000) return n;
    }
  }
  return EXECUTION_TIMEOUT_MS;
}

function notifyReady(value: boolean) {
  readyFlag = value;
  engineReadySubscribers.forEach((f) => f());
}

function rejectAll(e: GuardLimitError) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(e);
  }
  pending.clear();
}

function createWorker() {
  worker = new Worker(new URL("./worker-exec.ts", import.meta.url), { type: "module" });
  readyFlag = false;
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const message = ev.data;
    if (message.type === "就绪") {
      const waiters = [...readyWaiters];
      readyWaiters.clear();
      waiters.forEach((f) => f());
      notifyReady(true);
      return;
    }
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      entry.resolve(message.result);
    }
  };
  worker.onerror = () => {
    // Worker 崩溃：拒绝所有挂起请求并标记需重建
    rejectAll(new GuardLimitError("环境异常", ENV_ERROR_MESSAGE));
    worker?.terminate();
    worker = null;
    notifyReady(false);
  };
}

async function ensureWorkerReady(): Promise<Worker> {
  if (worker && readyFlag) return worker;
  if (!worker) createWorker();
  if (readyFlag) return worker!;
  // 等待 Worker 的"就绪"消息（首次或重建后需重新加载 WASM）
  await new Promise<void>((resolve) => {
    readyWaiters.add(resolve);
  });
  return worker!;
}

/** 提交判题请求：Worker 忙碌（同步执行中）时消息排队，天然串行 */
export async function requestJudge(
  studentSql: string,
  session: Session,
  question: QuestionInstance,
): Promise<JudgeResult> {
  if (typeof window === "undefined") {
    throw new Error("判题 Worker 仅在浏览器环境可用");
  }
  const w = await ensureWorkerReady();
  const id = nextId++;
  return new Promise<JudgeResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 超时兜底：sql.js 同步执行无法取消，只能整体终止 Worker（主线程 UI 不受影响）
      pending.delete(id);
      w.terminate();
      if (worker === w) {
        worker = null;
        notifyReady(false);
      }
      reject(new GuardLimitError("超时", timeoutMessage()));
    }, currentTimeoutMs());
    pending.set(id, { resolve, reject, timer });
    const request: WorkerRequest = { id, studentSql, session, question };
    w.postMessage(request);
  });
}

function timeoutMessage(): string {
  return `查询执行超过 ${currentTimeoutMs() / 1000} 秒上限，已自动终止。请检查是否缺少 JOIN 连接条件形成笛卡尔积、或过滤条件过宽，修改后重试。`;
}

/** 引擎就绪态订阅（首次 WASM 加载指示） */
export function subscribeEngineReady(callback: () => void): () => void {
  engineReadySubscribers.add(callback);
  return () => engineReadySubscribers.delete(callback);
}

export function isEngineReady(): boolean {
  return readyFlag;
}
