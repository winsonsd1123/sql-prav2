"use client";

import { useSyncExternalStore, useMemo, useState } from "react";
import { 生成 } from "@/kernel/generate";
import { 判定 } from "@/kernel/judge";
import { 显示 } from "@/kernel/execute";
import type { 判定结果, 结果集, 题目实例 } from "@/kernel/types";
import { 加载域包A } from "@/domain-packs/学生课程成绩/域包A";

const 种子键 = "sql-playground:seed";

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

function 结果表格({ 标题, 结果 }: { 标题: string; 结果: 结果集 }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">{标题}</p>
      <div className="overflow-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          {结果.列名.length > 0 && (
            <thead className="bg-zinc-100 dark:bg-zinc-900">
              <tr>
                {结果.列名.map((列, i) => (
                  <th key={i} className="px-2 py-1 text-left font-medium">{列}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {结果.行.map((行, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                {行.map((值, j) => (
                  <td key={j} className="px-2 py-1 whitespace-nowrap">
                    {值 === null ? <em className="text-zinc-400">NULL</em> : 显示(值)}
                  </td>
                ))}
              </tr>
            ))}
            {结果.行.length === 0 && (
              <tr>
                <td className="px-2 py-1 text-zinc-400">（空结果）</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const 域包 = useMemo(() => 加载域包A(), []);
  const 会话 = useMemo(
    () => (种子 === null ? null : 生成(种子, 域包)),
    [种子, 域包],
  );
  const [当前题号, 设当前题号] = useState(0);
  const [SQL输入, 设SQL输入] = useState("");
  const [结果, 设结果] = useState<判定结果 | null>(null);
  const [判定中, 设判定中] = useState(false);

  if (!会话) {
    return <p className="p-8 text-zinc-500">正在生成会话……</p>;
  }

  const 题目: 题目实例 = 会话.题目[当前题号];

  async function 验证() {
    if (!会话) return;
    设判定中(true);
    try {
      设结果(await 判定(SQL输入, 会话, 会话.题目[当前题号]));
    } finally {
      设判定中(false);
    }
  }

  function 换一套() {
    设新种子(Math.floor(Math.random() * 1_000_000_000));
    设结果(null);
    设SQL输入("");
    设当前题号(0);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">SQL 演练场</h1>
        <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            会话种子：<code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-900">{会话.种子}</code>
            （域包：{域包.名称}）
          </span>
          <button
            onClick={换一套}
            className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            换一套
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-6 lg:flex-row">
        {/* 侧边库浏览器 */}
        <aside className="w-full shrink-0 space-y-4 lg:w-72">
          <h2 className="font-medium text-zinc-500">库浏览器</h2>
          {会话.库.表.map((表) => (
            <details key={表.表名} open className="rounded border border-zinc-200 dark:border-zinc-800">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                {表.表名}（{表.行.length} 行）
              </summary>
              <div className="px-3 pb-2 text-xs text-zinc-500">
                <p className="mb-1">
                  列：{表.列名.map((列, i) => `${列} ${表.类型[i]}`).join("、")}
                </p>
                <div className="overflow-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        {表.列名.map((列) => (
                          <th key={列} className="pr-2 text-left font-medium">{列}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {表.行.map((行, i) => (
                        <tr key={i}>
                          {行.map((值, j) => (
                            <td key={j} className="pr-2 whitespace-nowrap">
                              {值 === null ? <em className="text-zinc-400">NULL</em> : String(值)}
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
        </aside>

        {/* 主区：题目 + 编辑器 + 结果 */}
        <main className="min-w-0 flex-1 space-y-4">
          <section className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 text-xs">
              <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {题目.知识点}
              </span>
              <span className="ml-2 text-zinc-400">难度 {题目.难度} · 第 {当前题号 + 1}/{会话.题目.length} 题</span>
            </p>
            <p className="mb-3">{题目.题面}</p>
            <div className="flex gap-2">
              {会话.题目.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    设当前题号(i);
                    设结果(null);
                    设SQL输入("");
                  }}
                  className={`h-7 w-7 rounded-full text-xs ${
                    i === 当前题号
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                      : "border border-zinc-300 text-zinc-500 dark:border-zinc-700"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <textarea
              value={SQL输入}
              onChange={(e) => 设SQL输入(e.target.value)}
              rows={5}
              placeholder="在此输入单条 SELECT 语句……"
              className="w-full rounded border border-zinc-300 p-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              onClick={验证}
              disabled={判定中 || SQL输入.trim().length === 0}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {判定中 ? "判定中……" : "验证"}
            </button>
          </section>

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
                  <div className="grid gap-4 md:grid-cols-2">
                    <结果表格 标题="我的结果" 结果={结果.学生结果} />
                    <结果表格 标题="预期结果" 结果={结果.预期结果} />
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
