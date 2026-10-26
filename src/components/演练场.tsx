"use client";

import { useSyncExternalStore, useMemo, useState, useEffect, useRef } from "react";
import { 生成练习会话 } from "@/kernel/出题";
import { 请求判定, 订阅引擎就绪, 引擎是否就绪 } from "@/kernel/worker客户端";
import SQL编辑器 from "@/components/SQL编辑器";
import 库浏览器 from "@/components/库浏览器";
import 差异对照 from "@/components/差异对照";
import 提示与答案 from "@/components/提示与答案";
import {
  种子存储,
  域包存储,
  进度存储,
  迁移进度,
  换一套种子,
  设域包,
  实例名,
  域包注册表,
} from "@/components/会话存储";
import {
  空进度,
  记通过,
  揭示下一层提示,
  借助答案,
  完成度,
  是否借助答案,
} from "@/components/进度";
import type { 判定结果, 题目实例 } from "@/kernel/types";

// UI 编排组件：会话级本地状态（种子/域包/进度）在 会话存储，判题在 Worker，
// 本组件只负责把它们接到界面与交互上。视觉层为「霓虹练习簿」（issue #12 T1）。

export default function Playground() {
  // 种子/域包/进度：三个外部存储，写入走共享通知总线（见 会话存储）
  const 种子 = useSyncExternalStore(种子存储.订阅, 种子存储.取快照, () => null);
  const 域包ID = useSyncExternalStore(
    域包存储.订阅,
    域包存储.取快照,
    () => 域包注册表[0].域包ID, // SSR 快照：客户端真实值在 hydrate 后生效
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
  const 进度 = useSyncExternalStore(进度存储.订阅, 进度存储.取快照, () => 空进度);

  if (!会话) {
    return <p className="p-8 text-ink/60">正在生成会话……</p>;
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
      if (结果.判定 === "通过") 迁移进度((p) => 记通过(p, 发起题号));
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
    换一套种子();
    重置作答();
  }

  function 切换域包(目标域包ID: string) {
    if (目标域包ID === 域包.域包ID) return;
    设域包(目标域包ID);
    重置作答();
  }

  /** 左栏题目目录行：状态章样式（已过=通过描边 / 借助答案=紫 / 未做=虚线 / 当前=强调实底） */
  function 题目行类(i: number): string {
    if (i === 当前题号) return "bg-accent text-bg border-border-strong";
    if (进度.已借助答案题号.includes(i))
      return "text-assist border-assist";
    if (进度.已通过题号.includes(i)) return "text-pass border-pass";
    return "text-ink/55 border-dashed border-ink/40";
  }

  function 题目行章(i: number): string {
    if (i === 当前题号) return "▶";
    if (进度.已借助答案题号.includes(i)) return "✗";
    if (进度.已通过题号.includes(i)) return "✓";
    return "·";
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* 顶栏：glitch Logo + 域包分段控件 + 换一套 + 完成度迷你进度条 */}
      <header className="卡片 flex flex-wrap items-center justify-between gap-3 border-x-0 border-t-0 px-5 py-3">
        <h1 className="glitch标题 text-xl">SQL 演练场</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {/* 会话完成度：进度持久于 localStorage，刷新保留（黑框内霓虹填充） */}
          <span
            data-testid="完成度"
            className="卡片 硬阴影 硬阴影-强调 按压 flex items-center gap-2 rounded-none px-2.5 py-1 font-mono text-xs"
          >
            已完成 {已完成}/{总数}
          </span>
          {/* 业务域切换：同种子下在两个域包间交替练习（黑框胶囊组） */}
          <span className="卡片 flex overflow-hidden rounded-none p-0">
            {域包注册表.map((d) => (
              <button
                key={d.域包ID}
                onClick={() => 切换域包(d.域包ID)}
                className={`border-r-2 border-border-strong px-3 py-1 last:border-r-0 ${
                  d.域包ID === 域包.域包ID
                    ? "bg-accent font-medium text-bg"
                    : "text-ink/70 hover:bg-ink/5"
                }`}
              >
                {d.名称}
              </button>
            ))}
          </span>
          <button
            onClick={换一套}
            className="卡片 硬阴影 按压 rounded-none px-3 py-1 font-medium"
          >
            换一套（新种子）
          </button>
        </div>
      </header>

      {/* 三栏：左题目目录 / 中工作区 / 右辅助卡；小屏全单列 */}
      <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        {/* 左栏：题目目录（票据风，虚线分行；点击行为与原题号圆点一致） */}
        <aside className="入场 w-full shrink-0 lg:w-56">
          <div className="卡片 硬阴影 rounded-none">
            <p className="border-b-2 border-dashed border-ink/30 px-3 py-2 text-xs font-medium text-ink/60">
              题目目录（{会话.题目.length} 题）
            </p>
            <nav className="flex flex-col">
              {会话.题目.map((题, i) => (
                <button
                  key={i}
                  title={`${题.知识点}（难度 ${题.难度}）`}
                  onClick={() => {
                    设当前题号(i);
                    设结果(null);
                    设SQL输入("");
                  }}
                  className={`flex items-center gap-2 border-b border-dashed border-ink/20 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-ink/5 ${题目行类(i)}`}
                >
                  <span className="font-mono font-semibold">#{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1 truncate">{题.知识点}</span>
                  <span className="font-mono">{题目行章(i)}</span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* 中栏：题目贴纸卡 → 终端窗口编辑器 → 结果 → 验证 */}
        <main className="入场 入场-2 min-w-0 flex-1 space-y-4">
          <section className="卡片 硬阴影 rounded-none p-4">
            <p className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              {/* 知识点霓虹底小旗标 */}
              <span className="border-2 border-border-strong bg-accent px-2 py-0.5 font-medium text-bg">
                {题目.知识点}
              </span>
              {是否借助答案(进度, 当前题号) && (
                <span className="border-2 border-assist bg-panel px-2 py-0.5 font-medium text-assist">
                  已借助答案
                </span>
              )}
              <span className="ml-auto font-mono text-ink/50">
                第 {当前题号 + 1}/{会话.题目.length} 题 · 难度{"★".repeat(题目.难度)}
              </span>
            </p>
            <p className="mb-0 text-[17px] leading-[1.75]">{题目.题面}</p>
          </section>

          <section className="space-y-2">
            {/* 终端窗口装饰的编辑器：标题栏三窗口点 + 文件名 + 引擎状态灯 */}
            <div className="卡片 硬阴影 overflow-hidden rounded-none">
              <div className="flex items-center gap-2 border-b-2 border-border-strong bg-ink/5 px-3 py-1.5 text-xs text-ink/60">
                <span className="flex gap-1.5" aria-hidden>
                  <i className="h-2.5 w-2.5 rounded-full bg-fail" />
                  <i className="h-2.5 w-2.5 rounded-full bg-warn" />
                  <i className="h-2.5 w-2.5 rounded-full bg-pass" />
                </span>
                <span className="font-mono">query.sql</span>
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 font-mono ${
                    引擎就绪 ? "text-pass" : "呼吸 text-warn"
                  }`}
                >
                  <i className="h-2 w-2 rounded-full bg-current" />
                  {引擎就绪 ? "引擎就绪" : "引擎加载中"}
                </span>
              </div>
              <SQL编辑器 值={SQL输入} onChange={设SQL输入} onSubmit={验证} 表={会话.库.表} />
            </div>
            {/* WASM 首次加载指示：Worker 预热引擎期间可见（保留 testid 供 e2e 断言） */}
            {!引擎就绪 && (
              <p data-testid="引擎加载中" className="font-mono text-xs text-warn">
                数据库引擎（WASM）加载中……首次载入约需一两秒。
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={验证}
                disabled={判定中 || SQL输入.trim().length === 0}
                className="霓虹按钮 硬阴影 硬阴影-强调 按压 rounded-none border-2 border-border-strong bg-accent px-5 py-1.5 text-sm font-bold text-bg disabled:opacity-40 disabled:hover:translate-x-0 disabled:hover:shadow-none"
              >
                {判定中 ? "判定中……" : "验证"}
              </button>
              <span className="text-xs text-ink/50">
                Ctrl/⌘ + Enter 快速验证{判定中 ? "（判定在后台进行，可继续编辑或切换题目）" : ""}
              </span>
            </div>
          </section>

          {结果 && (
            <section className="入场 space-y-3">
              {结果.判定 === "通过" && (
                /* 通过章：pass 色描边章 + 落章弹跳 */
                <p className="落章 硬阴影 硬阴影-通过 rounded-none border-2 border-pass bg-panel px-4 py-2 font-bold text-pass">
                  通过！结果集与预期等价。
                </p>
              )}
              {结果.判定 === "拦截" && (
                <p className="硬阴影 硬阴影-错误 rounded-none border-2 border-warn bg-panel px-4 py-2 text-warn">
                  {结果.错误信息}
                </p>
              )}
              {结果.判定 === "错误" && (
                /* 错误终端：mysql> 黑窗、等宽、fail 色错误文本 */
                <pre className="硬阴影 硬阴影-错误 overflow-auto rounded-none border-2 border-border-strong bg-bg p-3 font-mono text-sm leading-relaxed">
                  <span className="text-ink/50">mysql&gt; </span>
                  <span className="text-ink">{SQL输入}</span>
                  {"\n"}
                  <span className="text-fail">{结果.错误信息}</span>
                </pre>
              )}
              {结果.判定 === "不通过" && (
                <div className="space-y-3">
                  <p className="硬阴影 硬阴影-错误 rounded-none border-2 border-fail bg-panel px-4 py-2 font-bold text-fail">
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

        {/* 右栏：库浏览器（T1 常驻，T3 再抽浮层）+ 提示与答案 + 完成度/种子信息卡 */}
        <aside className="入场 入场-3 w-full shrink-0 space-y-4 lg:w-80">
          <库浏览器 表={会话.库.表} 实例名={实例名(会话.种子)} />

          <div className="卡片 硬阴影 rounded-none p-3">
            <提示与答案
              key={当前题号}
              提示={题目.提示}
              参考答案={题目.参考答案}
              已看层数={进度.已看提示[String(当前题号)] ?? 0}
              已借助答案={是否借助答案(进度, 当前题号)}
              on揭示提示={() => 迁移进度((p) => 揭示下一层提示(p, 当前题号)[0])}
              on查看答案={() => 迁移进度((p) => 借助答案(p, 当前题号))}
            />
          </div>

          {/* 完成度进度条 + 种子信息卡 */}
          <div className="卡片 硬阴影 rounded-none p-3 font-mono text-xs">
            <p className="mb-2 text-ink/60">会话进度</p>
            <div className="mb-2 h-3 border-2 border-border-strong bg-bg">
              <div
                className="h-full bg-accent"
                style={{ width: `${总数 === 0 ? 0 : (已完成 / 总数) * 100}%` }}
              />
            </div>
            <p className="text-ink/60">
              会话种子：<span className="text-ink">{会话.种子}</span>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
