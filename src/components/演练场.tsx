"use client";

import { useSyncExternalStore, useMemo, useState, useEffect, useRef, useCallback } from "react";
import { generatePracticeSession } from "@/kernel/question-picking";
import { requestJudge, subscribeEngineReady, isEngineReady } from "@/kernel/worker-client";
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
  创建草稿保存器,
} from "@/components/会话存储";
import {
  空进度,
  记通过,
  记尝试,
  揭示下一层提示,
  查看答案,
  完成度,
  是否借助答案,
  是否已通过,
  提示是否解锁,
  答案是否解锁,
  答案解锁还差尝试,
  记草稿,
  取草稿,
  下一未通过题,
  完成分档统计,
} from "@/components/进度";
import 会话总结 from "@/components/会话总结";
import { usePermissions } from "@/components/current-permissions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { JudgeResult, QuestionInstance } from "@/kernel/types";

// UI 编排组件：会话级本地状态（种子/域包/进度）在 会话存储，判题在 Worker，
// 本组件只负责把它们接到界面与交互上。视觉层为「静室」：点阵画布、三栏工作台。

// 桌面断点（lg 1024px）作为外部系统订阅：SSR 按桌面快照渲染，客户端按真实视口纠正，
// 视口变化（旋转/缩放）实时跟随；用户一旦切换面板（按钮/Cmd+B/ESC）即覆盖默认值。
const 订阅桌面断点 = (回调: () => void) => {
  const 查询 = window.matchMedia("(min-width: 1024px)");
  查询.addEventListener("change", 回调);
  return () => 查询.removeEventListener("change", 回调);
};
const 取桌面快照 = () => window.matchMedia("(min-width: 1024px)").matches;

export default function Playground() {
  // 种子/域包/进度：三个外部存储，写入走共享通知总线（见 会话存储）
  const 种子 = useSyncExternalStore(种子存储.订阅, 种子存储.取快照, () => null);
  const 域包ID = useSyncExternalStore(
    域包存储.订阅,
    域包存储.取快照,
    () => 域包注册表[0].packId, // SSR 快照：客户端真实值在 hydrate 后生效
  );
  const 域包 = useMemo(
    () => 域包注册表.find((d) => d.packId === 域包ID) ?? 域包注册表[0],
    [域包ID],
  );
  const 会话 = useMemo(
    () => (种子 === null ? null : generatePracticeSession(种子, 域包)),
    [种子, 域包],
  );
  const [当前题号, 设当前题号] = useState(0);
  // 当前用户权限点（T5）：持「随时查看参考答案」者豁免答案门槛（教学检视，不记借助）；
  // 无权限点（含加载失败回退）一律走学生摩擦力
  const permissionSet = usePermissions();
  const 答案豁免 = hasPermission(permissionSet, PERMISSIONS.viewAnswersAnytime);
  const [SQL输入, 设SQL输入] = useState("");
  const [结果, 设结果] = useState<JudgeResult | null>(null);
  const [判定中, 设判定中] = useState(false);
  // 表结构右栏（默认展开，写 SQL 时列名保持可见）。顶栏按钮 / Cmd/Ctrl+B 切换，Esc 收起。
  // 点编辑器不收起。
  // 表结构面板可见性：桌面默认展开、窄屏默认收起（不堆在编辑器下方）；
  // 用户切换（null=未干预）覆盖断点默认值。
  const 是桌面视口 = useSyncExternalStore(订阅桌面断点, 取桌面快照, () => true);
  const [用户切换面板, 设用户切换面板] = useState<boolean | null>(null);
  const 库浏览器开 = 用户切换面板 ?? 是桌面视口;
  // 快捷键 effect 只挂载一次，经 ref 读最新的用户切换值
  const 用户切换面板Ref = useRef<boolean | null>(null);
  useEffect(() => {
    用户切换面板Ref.current = 用户切换面板;
  }, [用户切换面板]);
  const 关闭库浏览器 = useCallback(() => 设用户切换面板(false), []);
  useEffect(() => {
    // 全局快捷键：Cmd/Ctrl+B 随时切换；ESC 仅在面板展开时收起（不劫持编辑器输入；
    // 焦点在编辑器内按 ESC 属编辑动作（如取消补全），不连带收起）。
    // 捕获阶段监听，避免 CodeMirror 内先行拦截。effect 内直接读断点，规避陈旧闭包。
    function 按键(e: KeyboardEvent) {
      const 面板当前开 = 用户切换面板Ref.current ?? window.matchMedia("(min-width: 1024px)").matches;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        设用户切换面板(!面板当前开);
      } else if (e.key === "Escape") {
        if ((e.target as HTMLElement | null)?.closest?.(".cm-editor")) return;
        if (面板当前开) 设用户切换面板(false);
      }
    }
    window.addEventListener("keydown", 按键, true);
    return () => window.removeEventListener("keydown", 按键, true);
  }, []);
  // 引擎就绪态（issue #10）：Worker 启动即加载 WASM，主线程展示首次加载指示
  const [引擎就绪, 设引擎就绪] = useState(isEngineReady);
  useEffect(() => subscribeEngineReady(() => 设引擎就绪(isEngineReady())), []);
  // 长查询期间学生可能切题：判题返回时若已切题则丢弃（结果属于旧题）
  const 当前题号引用 = useRef(当前题号);
  useEffect(() => {
    当前题号引用.current = 当前题号;
  }, [当前题号]);

  // 通过后自动流转（issue #18 T7）：反馈条 + 1.5 秒倒计时跳到环形查找的下一未通过题；
  // 倒计时内编辑或点击界面即取消跳转、反馈条转常驻；目标为 null（全部通过）不跳。
  const [通过反馈, 设通过反馈] = useState<{
    目标题号: number | null;
    倒计时中: boolean;
  } | null>(null);
  const 通过反馈引用 = useRef(通过反馈);
  useEffect(() => {
    通过反馈引用.current = 通过反馈;
  }, [通过反馈]);
  function 取消自动跳转() {
    设通过反馈((f) => (f?.倒计时中 ? { ...f, 倒计时中: false } : f));
  }
  // 倒计时期间点击界面任意处取消自动跳转（capture 兜底各种点击目标）
  useEffect(() => {
    if (!通过反馈?.倒计时中) return;
    window.addEventListener("pointerdown", 取消自动跳转, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", 取消自动跳转, { capture: true });
  }, [通过反馈]);

  // 1.5 秒静默后自动跳转：目标 = 环形查找的下一未通过题；跳转复用 切换题目（草稿落盘+恢复）
  useEffect(() => {
    if (!通过反馈?.倒计时中 || 通过反馈.目标题号 === null || !会话) return;
    const 目标 = 通过反馈.目标题号;
    const 计时器 = setTimeout(() => {
      设通过反馈(null);
      切换题目(目标);
    }, 1500);
    return () => clearTimeout(计时器);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 切换题目 为函数声明（组件内稳定编排逻辑），只在 通过反馈 变化时重排计时
  }, [通过反馈, 会话]);

  // 禁粘贴横幅（issue #17 T6）：拦截时编辑器上方提示约 2 秒，
  // 同一会话内只弹一次（连续触发不刷屏，ADR-0003 摩擦力设计）；换一套即新会话，可再弹一次。
  const [显示禁粘横幅, 设显示禁粘横幅] = useState(false);
  const 已弹过禁粘横幅 = useRef(false);
  const 禁粘横幅计时器 = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (禁粘横幅计时器.current) clearTimeout(禁粘横幅计时器.current);
    };
  }, []);
  function 提示禁粘贴() {
    if (已弹过禁粘横幅.current) return; // 同一会话内不重复弹
    已弹过禁粘横幅.current = true;
    设显示禁粘横幅(true);
    禁粘横幅计时器.current = setTimeout(() => 设显示禁粘横幅(false), 2000);
  }

  // 进度随会话（域包+种子）持久于 localStorage；换一套/换域包即换键，天然重置
  const 进度 = useSyncExternalStore(进度存储.订阅, 进度存储.取快照, () => 空进度);

  // 会话总结（issue #19 T8）：触发语义为「事件性」——仅在"从非全通过变为全通过"
  // 的时刻弹出；刷新载入已全通过的进度（首帧即全通过）不重弹。新会话（换一套/换域包）
  // 重置进度后，再次全通过会重新触发。
  const [总结开, 设总结开] = useState(false);
  const 上一全通过 = useRef<boolean | null>(null);
  useEffect(() => {
    if (!会话) return;
    const 全通过 = 进度.已通过题号.length === 会话.questions.length;
    if (上一全通过.current === null) {
      上一全通过.current = 全通过; // 首帧：记录基线，不触发（刷新已全通过不重弹）
      return;
    }
    if (全通过 && !上一全通过.current) 设总结开(true);
    上一全通过.current = 全通过;
  }, [进度, 会话]);

  // SQL 草稿按题保留并随进度持久（issue #15）：逐键编辑走防抖写（500ms 静默窗口），
  // 切题/换会话/卸载前立即刷新，避免丢最后一次编辑。
  const 草稿保存器 = useMemo(
    () => 创建草稿保存器((题号, SQL) => 迁移进度((p) => 记草稿(p, 题号, SQL))),
    [],
  );
  // 编辑回调必须引用稳定：SQL编辑器 的 updateListener 在创建时捕获 onChange，
  // 内联箭头函数会是陈旧闭包（当前题号恒为首渲染值），故经 当前题号引用 取实时题号。
  const 编辑回调 = useMemo(
    () => (v: string) => {
      用户已编辑.current = true; // 首次编辑后不再自动跟随进度恢复草稿
      设SQL输入(v);
      草稿保存器.排程(当前题号引用.current, v);
      // 倒计时中学生开始编辑 → 取消自动跳转（引用取实时反馈态，避免陈旧闭包）
      if (通过反馈引用.current?.倒计时中) 取消自动跳转();
    },
    [草稿保存器],
  );
  // 会话就绪（种子非空）后恢复第 0 题草稿——SSR 期间进度为空快照，草稿在客户端载入。
  // 云端进度恢复（T6）可能在首帧后才写回本地：在用户首次编辑前持续跟随 进度 快照，
  // 使云端草稿恢复后同步进编辑器；一旦编辑则以用户输入为准（切题恢复由 切换题目 承担）。
  const 用户已编辑 = useRef(false);
  useEffect(() => {
    if (种子 === null || 用户已编辑.current) return;
    设SQL输入(取草稿(进度存储.取快照(), 当前题号));
  }, [种子, 进度, 当前题号]);
  // 刷新/关闭页面前与组件卸载时落盘待写草稿
  useEffect(() => {
    const 落盘 = () => 草稿保存器.立即刷新();
    window.addEventListener("beforeunload", 落盘);
    return () => {
      window.removeEventListener("beforeunload", 落盘);
      落盘();
    };
  }, [草稿保存器]);

  if (!会话) {
    return (
      <p className="标题 flex min-h-screen items-center justify-center text-lg text-muted">
        正在生成会话……
      </p>
    );
  }

  const 题目: QuestionInstance = 会话.questions[当前题号];
  const { 已完成, 总数 } = 完成度(进度, 会话.questions.length);

  async function 验证() {
    if (!会话) return;
    const 发起题号 = 当前题号;
    设判定中(true);
    try {
      // 判题在 Web Worker 中进行（issue #10）：主线程不阻塞，编辑/切题/浏览库保持可交互
      const 结果 = await requestJudge(SQL输入, 会话, 会话.questions[发起题号]);
      if (当前题号引用.current !== 发起题号) return; // 期间已切题，丢弃旧结果
      设结果(结果);
      if (结果.judge === "通过") {
        // 通过的提交不计尝试（issue #16 口径）
        const 此前未通过 = !是否已通过(进度存储.取快照(), 发起题号);
        迁移进度((p) => 记通过(p, 发起题号));
        // 仅首次通过触发自动流转（issue #18）：已通过题再次验证不弹反馈条
        if (此前未通过) {
          const 目标 = 下一未通过题(进度存储.取快照(), 发起题号, 会话.questions.length);
          设通过反馈({ 目标题号: 目标, 倒计时中: 目标 !== null });
        }
      } else {
        // 不通过/错误均计一次尝试
        迁移进度((p) => 记尝试(p, 发起题号));
      }
    } catch (e) {
      // 超时/行数上限等防护触发：产品级提示（非伪造 MySQL 错误）
      if (当前题号引用.current !== 发起题号) return;
      设结果({ judge: "拦截", errorMessage: e instanceof Error ? e.message : String(e) });
      // 防护拦截同样计一次尝试（口径：每次验证提交计 1，仅通过不计）
      迁移进度((p) => 记尝试(p, 发起题号));
    } finally {
      设判定中(false);
    }
  }

  function 重置作答() {
    设结果(null);
    设SQL输入("");
    设当前题号(0);
    设通过反馈(null); // 换会话后旧反馈条与倒计时不再有意义
    设总结开(false); // 旧会话的总结卡随换会话关闭
  }

  function 换一套() {
    草稿保存器.立即刷新(); // 先把待写草稿落盘到旧会话的进度键，再换键
    换一套种子();
    重置作答();
    已弹过禁粘横幅.current = false; // 新会话可再弹一次禁粘贴规则提示
  }

  function 切换域包(目标域包ID: string) {
    if (目标域包ID === 域包.packId) return;
    草稿保存器.立即刷新(); // 同上：落盘后再换键，避免草稿写进新会话
    设域包(目标域包ID);
    重置作答();
  }

  /** 切题：先落盘当前题待写草稿，再切换并恢复目标题已有草稿（issue #15）。
   *  草稿从 进度存储 实时快照读取（而非渲染闭包里的旧 进度）：
   *  防抖窗口内编辑→切题→切回时，落盘后的最新草稿才能被正确恢复。 */
  function 切换题目(目标题号: number) {
    草稿保存器.立即刷新();
    设当前题号(目标题号);
    设结果(null);
    设SQL输入(取草稿(进度存储.取快照(), 目标题号));
  }

  /** 左栏题目目录行状态（同一级联两处查表共享）：当前 > 借助答案 > 通过 > 未做 */
  type 题目行状态 = "当前" | "借助" | "通过" | "未做";
  function 题目行状态(i: number): 题目行状态 {
    if (i === 当前题号) return "当前";
    if (进度.已借助答案题号.includes(i)) return "借助";
    if (进度.已通过题号.includes(i)) return "通过";
    return "未做";
  }
  // 行状态只靠小圆点：当前=墨 / 借助=紫 / 通过=绿 / 未做=空心
  const 题目行点: Record<题目行状态, string> = {
    当前: "bg-ink/55",
    借助: "bg-assist",
    通过: "bg-pass",
    未做: "bg-transparent ring-1 ring-ink/30",
  };
  const 题目分组: { 知识点: string; 序号: number[] }[] = [];
  for (let i = 0; i < 会话.questions.length; i++) {
    const 知识点 = 会话.questions[i].knowledgeArea;
    const 末组 = 题目分组[题目分组.length - 1];
    if (!末组 || 末组.知识点 !== 知识点) 题目分组.push({ 知识点, 序号: [i] });
    else 末组.序号.push(i);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-4 lg:px-6">
      {总结开 && 会话 && (
        <会话总结
          分档={完成分档统计(进度, 会话.questions.length)}
          已完成={进度.已通过题号.length}
          总数={会话.questions.length}
          on再来一套={换一套}
          on关闭={() => 设总结开(false)}
        />
      )}

      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="标题 text-[1.65rem] leading-none">SQL 演练场</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-ink/[0.06] p-0.5">
            {域包注册表.map((d) => (
              <button
                key={d.packId}
                onClick={() => 切换域包(d.packId)}
                className={`rounded-full px-3 py-1 text-xs ${
                  d.packId === 域包.packId
                    ? "bg-panel font-medium text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                }`}
              >
                {d.name}
              </button>
            ))}
          </span>
          <span className="inline-flex items-center gap-2 px-1">
            <span className="h-1 w-14 overflow-hidden rounded-full bg-ink/10" aria-hidden>
              <span
                className="block h-full rounded-full bg-ink/40"
                style={{ width: `${总数 === 0 ? 0 : (已完成 / 总数) * 100}%` }}
              />
            </span>
            <span data-testid="完成度" className="font-mono text-xs text-muted">
              已完成 {已完成}/{总数}
            </span>
          </span>
          <button onClick={换一套} className="次按钮 px-3 py-1.5 text-xs">
            换一套（新种子）
          </button>
          <button
            onClick={() => 设用户切换面板(!库浏览器开)}
            aria-expanded={库浏览器开}
            className={`次按钮 px-3 py-1.5 text-xs ${库浏览器开 ? "ring-1 ring-ink/15" : ""}`}
          >
            表结构（Ctrl/⌘+B）
          </button>
        </div>
      </header>

      {/* 窄屏单列：题目 → 题面与编辑器 → 表结构 → 提示。桌面三栏并排。 */}
      <div className="flex flex-1 flex-col items-start gap-4 lg:flex-row">
        <aside className="入场 w-full shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-56 lg:overflow-y-auto">
          <nav className="卡片 横滑 flex gap-1 overflow-x-auto p-2 lg:block lg:overflow-visible">
            <p className="hidden px-2 py-1.5 text-xs text-muted lg:block">题目 · {会话.questions.length}</p>
            {题目分组.map((组) => (
              <div key={组.知识点} className="flex shrink-0 items-center gap-1 lg:mb-1 lg:block">
                <p className="hidden px-2 pt-2 pb-1 text-[11px] font-medium text-muted lg:block">
                  {组.知识点}
                </p>
                {组.序号.map((i) => {
                  const 状态 = 题目行状态(i);
                  return (
                    <button
                      key={i}
                      title={`${会话.questions[i].knowledgeArea}（难度 ${会话.questions[i].difficulty}）`}
                      onClick={() => 切换题目(i)}
                      className={`flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs lg:w-full ${
                        状态 === "当前"
                          ? "bg-ink/[0.06] font-medium text-ink"
                          : "text-ink hover:bg-ink/[0.04]"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${题目行点[状态]}`} />
                      <span className="font-mono">#{String(i + 1).padStart(2, "0")}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="入场 入场-2 min-w-0 w-full flex-1 space-y-4">
          <section className="卡片 p-5">
            <p className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-ink/[0.06] px-2.5 py-0.5 font-medium text-ink">
                {题目.knowledgeArea}
              </span>
              {是否借助答案(进度, 当前题号) && (
                <span className="rounded-full bg-assist/10 px-2.5 py-0.5 font-medium text-assist">
                  已借助答案
                </span>
              )}
              <span className="ml-auto font-mono text-muted">
                第 {当前题号 + 1}/{会话.questions.length} 题 · 难度{"★".repeat(题目.difficulty)}
              </span>
            </p>
            <p className="text-[17px] leading-[1.75]">{题目.prompt}</p>
          </section>

          <section className="space-y-3">
            {显示禁粘横幅 && (
              <p
                data-testid="禁粘横幅"
                className="卡片 入场 border-l-4 border-l-warn px-4 py-2.5 text-sm text-warn"
              >
                请手动输入 SQL，粘贴已禁用
              </p>
            )}
            <div className="卡片 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border-strong px-3 py-2 text-xs text-muted">
                <span className="font-mono">query.sql</span>
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 font-mono ${
                    引擎就绪 ? "text-pass" : "呼吸 text-warn"
                  }`}
                >
                  <i className="h-1.5 w-1.5 rounded-full bg-current" />
                  {引擎就绪 ? "引擎就绪" : "引擎加载中"}
                </span>
              </div>
              <SQL编辑器
                值={SQL输入}
                onChange={编辑回调}
                onSubmit={验证}
                表={会话.database.tables}
                on拦截粘贴={提示禁粘贴}
              />
            </div>
            {!引擎就绪 && (
              <p data-testid="引擎加载中" className="font-mono text-xs text-warn">
                数据库引擎（WASM）加载中……首次载入约需一两秒。
              </p>
            )}
            <div className="卡片 p-4">
              <p className="mb-3 text-xs font-medium text-muted">提示与答案</p>
              <提示与答案
                key={当前题号}
                提示={题目.hints}
                参考答案={题目.referenceAnswer}
                已看层数={进度.已看提示[String(当前题号)] ?? 0}
                已借助答案={是否借助答案(进度, 当前题号)}
                解锁状态={{
                  已通过: 是否已通过(进度, 当前题号),
                  提示已解锁: 提示是否解锁(进度, 当前题号),
                  答案已解锁: 答案是否解锁(进度, 当前题号, 答案豁免),
                  尝试次数: 进度.尝试次数[String(当前题号)] ?? 0,
                }}
                答案还差尝试={答案解锁还差尝试(进度, 当前题号, 答案豁免)}
                答案豁免={答案豁免}
                on揭示提示={() => 迁移进度((p) => 揭示下一层提示(p, 当前题号)[0])}
                on查看答案={() => 迁移进度((p) => 查看答案(p, 当前题号, 答案豁免)[0])}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={验证}
                disabled={判定中 || SQL输入.trim().length === 0}
                className="主按钮 px-5 py-2 text-sm"
              >
                {判定中 ? "判定中……" : "验证"}
              </button>
              <span className="text-xs text-muted">
                Ctrl/⌘ + Enter 快速验证{判定中 ? "（判定在后台进行，可继续编辑或切换题目）" : ""}
              </span>
            </div>
          </section>

          {结果 && (
            <section className="入场 space-y-3">
              {结果.judge === "通过" && (
                <p className="落章 卡片 border-l-4 border-l-pass px-4 py-2.5 font-medium text-pass">
                  通过！结果集与预期等价。
                </p>
              )}
              {结果.judge === "通过" && 通过反馈 && (
                <div
                  data-testid="通过反馈条"
                  className="卡片 入场 flex flex-wrap items-center gap-3 border-l-4 border-l-pass px-4 py-2.5 text-sm"
                >
                  {通过反馈.目标题号 === null ? (
                    <span className="font-medium text-pass">全部题目已通过！</span>
                  ) : (
                    <>
                      <span className="text-ink">
                        {通过反馈.倒计时中
                          ? `即将进入第 ${通过反馈.目标题号 + 1} 题（继续编辑可留下）……`
                          : `下一道未通过：第 ${通过反馈.目标题号 + 1} 题`}
                      </span>
                      <button
                        data-testid="下一题按钮"
                        onClick={() => {
                          const 目标 = 通过反馈.目标题号;
                          设通过反馈(null);
                          if (目标 !== null) 切换题目(目标);
                        }}
                        className="主按钮 px-3 py-1 text-sm"
                      >
                        下一题 →
                      </button>
                    </>
                  )}
                </div>
              )}
              {结果.judge === "拦截" && (
                <p className="卡片 border-l-4 border-l-warn px-4 py-2.5 text-warn">
                  {结果.errorMessage}
                </p>
              )}
              {结果.judge === "错误" && (
                <pre className="卡片 overflow-auto bg-deep p-3 font-mono text-sm leading-relaxed">
                  <span className="text-muted">mysql&gt; </span>
                  <span className="text-ink">{SQL输入}</span>
                  {"\n"}
                  <span className="text-fail">{结果.errorMessage}</span>
                </pre>
              )}
              {结果.judge === "不通过" && (
                <div className="space-y-3">
                  <p className="卡片 border-l-4 border-l-fail px-4 py-2.5 font-medium text-fail">
                    不通过：结果集与预期不等价，请对照两侧差异。
                  </p>
                  <差异对照
                    学生结果={结果.studentResult}
                    预期结果={结果.expectedResult}
                    ordered={题目.ordered}
                  />
                </div>
              )}
            </section>
          )}
        </main>

        {/* 右栏常挂载（保住表级折叠态），收起时整列让位、主区恢复全宽（spec 故事 28） */}
        <aside
          className={`入场 入场-3 flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:max-h-[calc(100vh-2rem)] lg:min-h-0 lg:overflow-hidden ${
            库浏览器开 ? "lg:w-[22rem]" : "lg:w-0 lg:gap-0 lg:border-0"
          }`}
        >
          <库浏览器
            表={会话.database.tables}
            实例名={实例名(会话.seed)}
            打开={库浏览器开}
            on关闭={关闭库浏览器}
          />
          {库浏览器开 && (
            <p className="shrink-0 px-1 font-mono text-[11px] text-muted">会话种子 {会话.seed}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
