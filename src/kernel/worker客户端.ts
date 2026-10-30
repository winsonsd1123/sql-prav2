// 判题 Worker 的主线程客户端（issue #10 / T9）。
// 职责：懒创建 Worker、跟踪引擎就绪态（首次 WASM 加载指示）、请求-应答配对、
// 超时兜底——sql.js 在 Worker 中同步执行无法中途取消，超时的唯一可靠手段是
// terminate() 整个 Worker（主线程与 UI 不受影响），下次请求前重建 Worker 并等待其重新就绪。

import type { Session, QuestionInstance, JudgeResult } from "./types";
import { 执行超时毫秒, 防护超限错误, 环境异常提示 } from "./防护";
import type { Worker请求, Worker应答 } from "./执行worker";

interface 等待项 {
  resolve: (r: JudgeResult) => void;
  reject: (e: 防护超限错误) => void;
  超时器: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let 就绪标志 = false;
const 就绪等待者们 = new Set<() => void>();
let 下一个id = 1;
const 等待中 = new Map<number, 等待项>();
const 引擎就绪订阅 = new Set<() => void>();

/** 单次判题超时；可用 URL 参数 timeoutMs 覆盖（100-60000，供 e2e 构造慢查询场景） */
function 当前超时毫秒(): number {
  if (typeof window !== "undefined") {
    const 覆盖 = new URLSearchParams(window.location.search).get("timeoutMs");
    if (覆盖 && /^\d+$/.test(覆盖)) {
      const n = Number(覆盖);
      if (n >= 100 && n <= 60_000) return n;
    }
  }
  return 执行超时毫秒;
}

function 通报就绪(值: boolean) {
  就绪标志 = 值;
  引擎就绪订阅.forEach((f) => f());
}

function 拒绝全部(e: 防护超限错误) {
  for (const 项 of 等待中.values()) {
    clearTimeout(项.超时器);
    项.reject(e);
  }
  等待中.clear();
}

function 创建worker() {
  worker = new Worker(new URL("./执行worker.ts", import.meta.url), { type: "module" });
  就绪标志 = false;
  worker.onmessage = (ev: MessageEvent<Worker应答>) => {
    const 消息 = ev.data;
    if (消息.type === "就绪") {
      const 等待者们 = [...就绪等待者们];
      就绪等待者们.clear();
      等待者们.forEach((f) => f());
      通报就绪(true);
      return;
    }
    const 项 = 等待中.get(消息.id);
    if (项) {
      等待中.delete(消息.id);
      clearTimeout(项.超时器);
      项.resolve(消息.结果);
    }
  };
  worker.onerror = () => {
    // Worker 崩溃：拒绝所有挂起请求并标记需重建
    拒绝全部(new 防护超限错误("环境异常", 环境异常提示));
    worker?.terminate();
    worker = null;
    通报就绪(false);
  };
}

async function 确保worker就绪(): Promise<Worker> {
  if (worker && 就绪标志) return worker;
  if (!worker) 创建worker();
  if (就绪标志) return worker!;
  // 等待 Worker 的"就绪"消息（首次或重建后需重新加载 WASM）
  await new Promise<void>((resolve) => {
    就绪等待者们.add(resolve);
  });
  return worker!;
}

/** 提交判题请求：Worker 忙碌（同步执行中）时消息排队，天然串行 */
export async function 请求判定(
  学生SQL: string,
  会话: Session,
  题目: QuestionInstance,
): Promise<JudgeResult> {
  if (typeof window === "undefined") {
    throw new Error("判题 Worker 仅在浏览器环境可用");
  }
  const w = await 确保worker就绪();
  const id = 下一个id++;
  return new Promise<JudgeResult>((resolve, reject) => {
    const 超时器 = setTimeout(() => {
      // 超时兜底：sql.js 同步执行无法取消，只能整体终止 Worker（主线程 UI 不受影响）
      等待中.delete(id);
      w.terminate();
      if (worker === w) {
        worker = null;
        通报就绪(false);
      }
      reject(new 防护超限错误("超时", 超时文案()));
    }, 当前超时毫秒());
    等待中.set(id, { resolve, reject, 超时器 });
    const 请求: Worker请求 = { id, 学生SQL, 会话, 题目 };
    w.postMessage(请求);
  });
}

function 超时文案(): string {
  return `查询执行超过 ${当前超时毫秒() / 1000} 秒上限，已自动终止。请检查是否缺少 JOIN 连接条件形成笛卡尔积、或过滤条件过宽，修改后重试。`;
}

/** 引擎就绪态订阅（首次 WASM 加载指示） */
export function 订阅引擎就绪(回调: () => void): () => void {
  引擎就绪订阅.add(回调);
  return () => 引擎就绪订阅.delete(回调);
}

export function 引擎是否就绪(): boolean {
  return 就绪标志;
}
