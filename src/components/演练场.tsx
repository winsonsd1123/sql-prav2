"use client";

import { useSyncExternalStore, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { 生成练习会话 } from "@/kernel/出题";
import { 请求判定, 订阅引擎就绪, 引擎是否就绪 } from "@/kernel/worker客户端";
import SQL编辑器 from "@/components/SQL编辑器";
import 库浏览器 from "@/components/库浏览器";
import 差异对照 from "@/components/差异对照";
import 提示与答案 from "@/components/提示与答案";
import {
  空进度,
  进度键,
  解析进度,
  记通过,
  揭示下一层提示,
  借助答案,
  完成度,
  是否借助答案,
  type 进度记录,
} from "@/components/进度";
import type { 判定结果, 题目实例 } from "@/kernel/types";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";
import { 加载域包B } from "@/domain-packs/员工部门薪资/域包B";
import type { 域包 } from "@/kernel/types";

// 域包注册表：学生可在两个业务域之间切换练习（issue #8）
const 域包注册表: 域包[] = [加载域包A(), 加载域包B()];

const 种子键 = "sql-playground:seed";
const 域包键 = "sql-playground:pack";

function 读取种子(): number {
  if (typeof window !== "undefined") {
    const 来自URL = new URLSearchParams(window.location.search).get("seed");
    if (来自URL && /^\d+$/.test(来自URL)) {
      const n = Number(来自URL);
      localStorage.setItem(种子键, String(n));
      return n;
    }
    const 已存 = localStorage.getItem(种子键);
    if (已存 && /^\d+$/.test(已存)) return Number(已存);
  }
  const 新种子 = Math.floor(Math.random() * 1_000_000_000);
  localStorage.setItem(种子键, String(新种子));
  window.history.replaceState(null, "", `?seed=${新种子}`);
  return 新种子;
}

// 种子作为外部存储：服务端快照为 null，客户端从 localStorage/URL 读取并缓存
let 缓存种子: number | null = null;
let 缓存域包ID: string | null = null;
const 订阅者 = new Set<() => void>();
function 取种子快照(): number | null {
  if (缓存种子 === null) 缓存种子 = 读取种子();
  return 缓存种子;
}
function 设新种子(n: number) {
  缓存种子 = n;
  localStorage.setItem(种子键, String(n));
  window.history.replaceState(null, "", `?seed=${n}`);
  订阅者.forEach((f) => f());
}

/** 当前域包ID：客户端从 localStorage 读取并缓存，非法值回退到域包A */
function 取域包ID快照(): string | null {
  if (typeof window === "undefined") return null;
  if (缓存域包ID === null) {
    const 已存 = localStorage.getItem(域包键);
    缓存域包ID = 域包注册表.some((d) => d.域包ID === 已存) ? 已存! : 域包注册表[0].域包ID;
  }
  return 缓存域包ID;
}
/** 切换域包：保留种子，只换业务域（同种子下两域包生成各自的库与题） */
function 设域包(域包ID: string) {
  缓存域包ID = 域包ID;
  localStorage.setItem(域包键, 域包ID);
  订阅者.forEach((f) => f());
}

/** 库实例名：随会话种子派生的随机名（同一会话稳定，换一套即换名） */
function 实例名(种子: number): string {
  return `practice_${String(种子).padStart(9, "0").slice(-4)}`;
}

// 进度外部存储：与种子/域包同一订阅体系；键随会话变化时惰性重载（等价于换一套/换域包重置）
let 缓存进度: 进度记录 = 空进度;
let 缓存进度键: string | null = null;
function 当前进度键(): string | null {
  return 缓存种子 !== null && 缓存域包ID !== null ? 进度键(缓存域包ID, 缓存种子) : null;
}
function 取进度快照(): 进度记录 {
  if (typeof window === "undefined") return 空进度;
  const 键 = 当前进度键();
  if (键 === null) return 空进度;
  if (缓存进度键 !== 键) {
    缓存进度键 = 键;
    缓存进度 = 解析进度(localStorage.getItem(键));
  }
  return 缓存进度;
}
function 迁移进度(迁移: (p: 进度记录) => 进度记录) {
  缓存进度 = 迁移(缓存进度);
  const 键 = 当前进度键();
  if (键 !== null) localStorage.setItem(键, JSON.stringify(缓存进度));
  订阅者.forEach((f) => f());
}

export default function Playground() {
  const 种子 = useSyncExternalStore(
    (通知) => {
      订阅者.add(通知);
      return () => 订阅者.delete(通知);
    },
    取种子快照,
    () => null,
  );
  const 域包ID = useSyncExternalStore(
    (通知) => {
      订阅者.add(通知);
      return () => 订阅者.delete(通知);
    },
    取域包ID快照,
    () => null,
  );
  const 域包 = useMemo(
    () => 域包注册表.find((d) => d.域包ID === 域包ID) ?? 域包注册表[0],
    [域包ID],
  );
  const 会话 = useMemo(
    () => (种子 === null ? null : 生成练习会话(种子, 域包)),
    [种子, 域包],
  );
  const [当前题号, 设当前题号] = useState(0);
  const [SQL输入, 设SQL输入] = useState("");
  const [结果, 设结果] = useState<判定结果 | null>(null);
  const [判定中, 设判定中] = useState(false);
  // 引擎就绪态（issue #10）：Worker 启动即加载 WASM，主线程展示首次加载指示
  const [引擎就绪, 设引擎就绪] = useState(引擎是否就绪);
  useEffect(() => 订阅引擎就绪(() => 设引擎就绪(引擎是否就绪())), []);
  // 长查询期间学生可能切题：判题返回时若已切题则丢弃（结果属于旧题）
  const 当前题号引用 = useRef(当前题号);
  useEffect(() => {
    当前题号引用.current = 当前题号;
  }, [当前题号]);

  // 进度随会话（域包+种子）持久于 localStorage；换一套/换域包即换键，天然重置
  const 进度 = useSyncExternalStore(
    (通知) => {
      订阅者.add(通知);
      return () => 订阅者.delete(通知);
    },
    取进度快照,
    () => 空进度,
  );
  const 更新进度 = useCallback((迁移: (p: 进度记录) => 进度记录) => 迁移进度(迁移), []);

  if (!会话) {
    return <p className="p-8 text-zinc-500">正在生成会话……</p>;
  }

  const 题目: 题目实例 = 会话.题目[当前题号];
  const { 已完成, 总数 } = 完成度(进度, 会话.题目.length);

  async function 验证() {
    if (!会话) return;
    const 发起题号 = 当前题号;
    设判定中(true);
    try {
      // 判题在 Web Worker 中进行（issue #10）：主线程不阻塞，编辑/切题/浏览库保持可交互
      const 结果 = await 请求判定(SQL输入, 会话, 会话.题目[发起题号]);
      if (当前题号引用.current !== 发起题号) return; // 期间已切题，丢弃旧结果
      设结果(结果);
      if (结果.判定 === "通过") 更新进度((p) => 记通过(p, 发起题号));
    } catch (e) {
      // 超时/行数上限等防护触发：产品级提示（非伪造 MySQL 错误）
      if (当前题号引用.current !== 发起题号) return;
      设结果({ 判定: "拦截", 错误信息: e instanceof Error ? e.message : String(e) });
    } finally {
      设判定中(false);
    }
  }

  function 重置作答() {
    设结果(null);
    设SQL输入("");
    设当前题号(0);
  }

  function 换一套() {
    设新种子(Math.floor(Math.random() * 1_000_000_000));
    重置作答();
  }

  function 切换域包(目标域包ID: string) {
    if (目标域包ID === 域包.域包ID) return;
    设域包(目标域包ID);
    重置作答();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">SQL 演练场</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          {/* 会话完成度：进度持久于 localStorage，刷新保留 */}
          <span data-testid="完成度" className="rounded bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-200">
            已完成 {已完成}/{总数}
          </span>
          <span>
            会话种子：<code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-900">{会话.种子}</code>
          </span>
          {/* 业务域切换：同种子下在两个域包间交替练习 */}
          <span className="flex items-center gap-1">
            {域包注册表.map((d) => (
              <button
                key={d.域包ID}
                onClick={() => 切换域包(d.域包ID)}
                className={`rounded border px-3 py-1 ${
                  d.域包ID === 域包.域包ID
                    ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                    : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {d.名称}
              </button>
            ))}
          </span>
          <button
            onClick={换一套}
            className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            换一套（新种子）
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-6 lg:flex-row">
        {/* 侧边库浏览器 */}
        <库浏览器 表={会话.库.表} 实例名={实例名(会话.种子)} />

        {/* 主区：题目 + 编辑器 + 提示/答案 + 结果 */}
        <main className="min-w-0 flex-1 space-y-4">
          <section className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 text-xs">
              <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {题目.知识点}
              </span>
              {是否借助答案(进度, 当前题号) && (
                <span className="ml-2 rounded bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900 dark:text-purple-200">
                  已借助答案
                </span>
              )}
              <span className="ml-2 text-zinc-400">难度 {题目.难度} · 第 {当前题号 + 1}/{会话.题目.length} 题</span>
            </p>
            <p className="mb-3">{题目.题面}</p>
            <div className="flex flex-wrap gap-2">
              {会话.题目.map((题, i) => (
                <button
                  key={i}
                  title={`${题.知识点}（难度 ${题.难度}）`}
                  onClick={() => {
                    设当前题号(i);
                    设结果(null);
                    设SQL输入("");
                  }}
                  className={`h-7 min-w-7 rounded-full px-1.5 text-xs ${
                    i === 当前题号
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                      : 进度.已通过题号.includes(i)
                        ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200"
                        : "border border-zinc-300 text-zinc-500 dark:border-zinc-700"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <SQL编辑器 值={SQL输入} onChange={设SQL输入} onSubmit={验证} 表={会话.库.表} />
            {/* WASM 首次加载指示：Worker 预热引擎期间可见 */}
            {!引擎就绪 && (
              <p data-testid="引擎加载中" className="text-xs text-amber-600 dark:text-amber-400">
                数据库引擎（WASM）加载中……首次载入约需一两秒。
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={验证}
                disabled={判定中 || SQL输入.trim().length === 0}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {判定中 ? "判定中……" : "验证"}
              </button>
              <span className="text-xs text-zinc-400">Ctrl/⌘ + Enter 快速验证{判定中 ? "（判定在后台进行，可继续编辑或切换题目）" : ""}</span>
            </div>
          </section>

          <提示与答案
            key={当前题号}
            提示={题目.提示}
            参考答案={题目.参考答案}
            已看层数={进度.已看提示[String(当前题号)] ?? 0}
            已借助答案={是否借助答案(进度, 当前题号)}
            on揭示提示={() => 更新进度((p) => 揭示下一层提示(p, 当前题号)[0])}
            on查看答案={() => 更新进度((p) => 借助答案(p, 当前题号))}
          />

          {结果 && (
            <section className="space-y-3">
              {结果.判定 === "通过" && (
                <p className="rounded bg-green-100 px-4 py-2 font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                  通过！结果集与预期等价。
                </p>
              )}
              {结果.判定 === "拦截" && (
                <p className="rounded bg-amber-100 px-4 py-2 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                  {结果.错误信息}
                </p>
              )}
              {结果.判定 === "错误" && (
                /* 终端风格：mysql> 提示符 + 学生输入 + MySQL 格式错误逐字呈现 */
                <pre className="overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-sm leading-relaxed">
                  <span className="text-zinc-500">mysql&gt; </span>
                  <span className="text-zinc-100">{SQL输入}</span>
                  {"\n"}
                  <span className="text-red-400">{结果.错误信息}</span>
                </pre>
              )}
              {结果.判定 === "不通过" && (
                <div className="space-y-3">
                  <p className="rounded bg-red-100 px-4 py-2 font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
                    不通过：结果集与预期不等价，请对照两侧差异。
                  </p>
                  <差异对照
                    学生结果={结果.学生结果}
                    预期结果={结果.预期结果}
                    ordered={题目.ordered}
                  />
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
