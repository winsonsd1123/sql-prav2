"use client";

import { useSyncExternalStore, useMemo, useState, useEffect, useRef, useCallback } from "react";
import { generatePracticeSession } from "@/kernel/question-picking";
import { requestJudge, subscribeEngineReady, isEngineReady } from "@/kernel/worker-client";
import SqlEditor from "@/components/SqlEditor";
import LibraryBrowser from "@/components/LibraryBrowser";
import DiffComparison from "@/components/DiffComparison";
import HintsAndAnswer from "@/components/HintsAndAnswer";
import {
  seedStore,
  packStore,
  progressStore,
  migrateProgress,
  regenerateSession,
  setPack,
  instanceLabel,
  domainPackRegistry,
  createDraftSaver,
} from "@/components/session-store";
import {
  emptyProgress,
  recordPass,
  recordAttempt,
  revealNextHintLayer,
  viewAnswer,
  completion,
  usedAnswerAssistance,
  isPassed,
  isHintUnlocked,
  isAnswerUnlocked,
  attemptsToUnlockAnswer,
  saveDraft,
  getDraft,
  nextUnpassedQuestion,
  completionTierStats,
} from "@/components/progress";
import SessionSummary from "@/components/SessionSummary";
import { usePermissions } from "@/components/current-permissions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { JudgeResult, QuestionInstance } from "@/kernel/types";

// UI 编排组件：会话级本地状态（种子/域包/进度）在 会话存储，判题在 Worker，
// 本组件只负责把它们接到界面与交互上。视觉层为「静室」：点阵画布、三栏工作台。

// 桌面断点（lg 1024px）作为外部系统订阅：SSR 按桌面快照渲染，客户端按真实视口纠正，
// 视口变化（旋转/缩放）实时跟随；用户一旦切换面板（按钮/Cmd+B/ESC）即覆盖默认值。
const subscribeDesktopBreakpoint = (callback: () => void) => {
  const mediaQuery = window.matchMedia("(min-width: 1024px)");
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
};
const desktopSnapshot = () => window.matchMedia("(min-width: 1024px)").matches;

export default function Playground() {
  // 种子/域包/进度：三个外部存储，写入走共享通知总线（见 会话存储）
  const seed = useSyncExternalStore(seedStore.subscribe, seedStore.getSnapshot, () => null);
  const packId = useSyncExternalStore(
    packStore.subscribe,
    packStore.getSnapshot,
    () => domainPackRegistry[0].packId, // SSR 快照：客户端真实值在 hydrate 后生效
  );
  const pack = useMemo(
    () => domainPackRegistry.find((d) => d.packId === packId) ?? domainPackRegistry[0],
    [packId],
  );
  const session = useMemo(
    () => (seed === null ? null : generatePracticeSession(seed, pack)),
    [seed, pack],
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // 当前用户权限点（T5）：持「随时查看参考答案」者豁免答案门槛（教学检视，不记借助）；
  // 无权限点（含加载失败回退）一律走学生摩擦力
  const permissionSet = usePermissions();
  const answerExemption = hasPermission(permissionSet, PERMISSIONS.viewAnswersAnytime);
  const [sqlInput, setSqlInput] = useState("");
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [judging, setJudging] = useState(false);
  // 表结构右栏（默认展开，写 SQL 时列名保持可见）。顶栏按钮 / Cmd/Ctrl+B 切换，Esc 收起。
  // 点编辑器不收起。
  // 表结构面板可见性：桌面默认展开、窄屏默认收起（不堆在编辑器下方）；
  // 用户切换（null=未干预）覆盖断点默认值。
  const isDesktopViewport = useSyncExternalStore(subscribeDesktopBreakpoint, desktopSnapshot, () => true);
  const [userPanelToggle, setUserPanelToggle] = useState<boolean | null>(null);
  const libraryBrowserOpen = userPanelToggle ?? isDesktopViewport;
  // 快捷键 effect 只挂载一次，经 ref 读最新的用户切换值
  const userPanelToggleRef = useRef<boolean | null>(null);
  useEffect(() => {
    userPanelToggleRef.current = userPanelToggle;
  }, [userPanelToggle]);
  const closeLibraryBrowser = useCallback(() => setUserPanelToggle(false), []);
  useEffect(() => {
    // 全局快捷键：Cmd/Ctrl+B 随时切换；ESC 仅在面板展开时收起（不劫持编辑器输入；
    // 焦点在编辑器内按 ESC 属编辑动作（如取消补全），不连带收起）。
    // 捕获阶段监听，避免 CodeMirror 内先行拦截。effect 内直接读断点，规避陈旧闭包。
    function onKeydown(e: KeyboardEvent) {
      const panelCurrentlyOpen = userPanelToggleRef.current ?? window.matchMedia("(min-width: 1024px)").matches;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setUserPanelToggle(!panelCurrentlyOpen);
      } else if (e.key === "Escape") {
        if ((e.target as HTMLElement | null)?.closest?.(".cm-editor")) return;
        if (panelCurrentlyOpen) setUserPanelToggle(false);
      }
    }
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  }, []);
  // 引擎就绪态（issue #10）：Worker 启动即加载 WASM，主线程展示首次加载指示
  const [engineReady, setEngineReady] = useState(isEngineReady);
  useEffect(() => subscribeEngineReady(() => setEngineReady(isEngineReady())), []);
  // 长查询期间学生可能切题：判题返回时若已切题则丢弃（结果属于旧题）
  const currentQuestionIndexRef = useRef(currentQuestionIndex);
  useEffect(() => {
    currentQuestionIndexRef.current = currentQuestionIndex;
  }, [currentQuestionIndex]);

  // 通过后自动流转（issue #18 T7）：反馈条 + 1.5 秒倒计时跳到环形查找出的下一道未通过题（nextUnpassedQuestion）；
  // 倒计时内编辑或点击界面即取消跳转、反馈条转常驻；目标为 null（全部通过）不跳。
  const [passFeedback, setPassFeedback] = useState<{
    targetIndex: number | null;
    countingDown: boolean;
  } | null>(null);
  const passFeedbackRef = useRef(passFeedback);
  useEffect(() => {
    passFeedbackRef.current = passFeedback;
  }, [passFeedback]);
  function cancelAutoAdvance() {
    setPassFeedback((f) => (f?.countingDown ? { ...f, countingDown: false } : f));
  }
  // 倒计时期间点击界面任意处取消自动跳转（capture 兜底各种点击目标）
  useEffect(() => {
    if (!passFeedback?.countingDown) return;
    window.addEventListener("pointerdown", cancelAutoAdvance, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", cancelAutoAdvance, { capture: true });
  }, [passFeedback]);

  // 1.5 秒静默后自动跳转：目标 = 环形查找出的下一道未通过题；跳转复用 切换题目（草稿落盘+恢复）
  useEffect(() => {
    if (!passFeedback?.countingDown || passFeedback.targetIndex === null || !session) return;
    const target = passFeedback.targetIndex;
    const timer = setTimeout(() => {
      setPassFeedback(null);
      switchQuestion(target);
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 切换题目 为函数声明（组件内稳定编排逻辑），只在 通过反馈 变化时重排计时
  }, [passFeedback, session]);

  // 禁粘贴横幅（issue #17 T6）：拦截时编辑器上方提示约 2 秒，
  // 同一会话内只弹一次（连续触发不刷屏，ADR-0003 摩擦力设计）；换一套即新会话，可再弹一次。
  const [showNoPasteBanner, setShowNoPasteBanner] = useState(false);
  const noPasteBannerShown = useRef(false);
  const noPasteBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (noPasteBannerTimer.current) clearTimeout(noPasteBannerTimer.current);
    };
  }, []);
  function notifyNoPaste() {
    if (noPasteBannerShown.current) return; // 同一会话内不重复弹
    noPasteBannerShown.current = true;
    setShowNoPasteBanner(true);
    noPasteBannerTimer.current = setTimeout(() => setShowNoPasteBanner(false), 2000);
  }

  // 进度随会话（域包+种子）持久于 localStorage；换一套/换域包即换键，天然重置
  const progress = useSyncExternalStore(progressStore.subscribe, progressStore.getSnapshot, () => emptyProgress);

  // 会话总结（issue #19 T8）：触发语义为「事件性」——仅在"从非全通过变为全通过"
  // 的时刻弹出；刷新载入已全通过的进度（首帧即全通过）不重弹。新会话（换一套/换域包）
  // 重置进度后，再次全通过会重新触发。
  const [summaryOpen, setSummaryOpen] = useState(false);
  const wasAllPassed = useRef<boolean | null>(null);
  useEffect(() => {
    if (!session) return;
    const allPassed = progress.passedIndices.length === session.questions.length;
    if (wasAllPassed.current === null) {
      wasAllPassed.current = allPassed; // 首帧：记录基线，不触发（刷新已全通过不重弹）
      return;
    }
    if (allPassed && !wasAllPassed.current) setSummaryOpen(true);
    wasAllPassed.current = allPassed;
  }, [progress, session]);

  // SQL 草稿按题保留并随进度持久（issue #15）：逐键编辑走防抖写（500ms 静默窗口），
  // 切题/换会话/卸载前立即刷新，避免丢最后一次编辑。
  const draftSaver = useMemo(
    () => createDraftSaver((questionIndex, sql) => migrateProgress((p) => saveDraft(p, questionIndex, sql))),
    [],
  );
  // 编辑回调必须引用稳定：SQL编辑器 的 updateListener 在创建时捕获 onChange，
  // 内联箭头函数会是陈旧闭包（当前题号恒为首渲染值），故经 当前题号引用 取实时题号。
  const onEdit = useMemo(
    () => (v: string) => {
      userEdited.current = true; // 首次编辑后不再自动跟随进度恢复草稿
      setSqlInput(v);
      draftSaver.schedule(currentQuestionIndexRef.current, v);
      // 倒计时中学生开始编辑 → 取消自动跳转（引用取实时反馈态，避免陈旧闭包）
      if (passFeedbackRef.current?.countingDown) cancelAutoAdvance();
    },
    [draftSaver],
  );
  // 会话就绪（种子非空）后恢复第 0 题草稿——SSR 期间进度为空快照，草稿在客户端载入。
  // 云端进度恢复（T6）可能在首帧后才写回本地：在用户首次编辑前持续跟随 进度 快照，
  // 使云端草稿恢复后同步进编辑器；一旦编辑则以用户输入为准（切题恢复由 切换题目 承担）。
  const userEdited = useRef(false);
  useEffect(() => {
    if (seed === null || userEdited.current) return;
    setSqlInput(getDraft(progressStore.getSnapshot(), currentQuestionIndex));
  }, [seed, progress, currentQuestionIndex]);
  // 刷新/关闭页面前与组件卸载时落盘待写草稿
  useEffect(() => {
    const flush = () => draftSaver.flushNow();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [draftSaver]);

  if (!session) {
    return (
      <p className="标题 flex min-h-screen items-center justify-center text-lg text-muted">
        正在生成会话……
      </p>
    );
  }

  const question: QuestionInstance = session.questions[currentQuestionIndex];
  const { completed, total } = completion(progress, session.questions.length);

  async function verify() {
    if (!session) return;
    const submittedIndex = currentQuestionIndex;
    setJudging(true);
    try {
      // 判题在 Web Worker 中进行（issue #10）：主线程不阻塞，编辑/切题/浏览库保持可交互
      const result = await requestJudge(sqlInput, session, session.questions[submittedIndex]);
      if (currentQuestionIndexRef.current !== submittedIndex) return; // 期间已切题，丢弃旧结果
      setResult(result);
      if (result.judge === "通过") {
        // 通过的提交不计尝试（issue #16 口径）
        const wasUnpassed = !isPassed(progressStore.getSnapshot(), submittedIndex);
        migrateProgress((p) => recordPass(p, submittedIndex));
        // 仅首次通过触发自动流转（issue #18）：已通过题再次验证不弹反馈条
        if (wasUnpassed) {
          const target = nextUnpassedQuestion(progressStore.getSnapshot(), submittedIndex, session.questions.length);
          setPassFeedback({ targetIndex: target, countingDown: target !== null });
        }
      } else {
        // 不通过/错误均计一次尝试
        migrateProgress((p) => recordAttempt(p, submittedIndex));
      }
    } catch (e) {
      // 超时/行数上限等防护触发：产品级提示（非伪造 MySQL 错误）
      if (currentQuestionIndexRef.current !== submittedIndex) return;
      setResult({ judge: "拦截", errorMessage: e instanceof Error ? e.message : String(e) });
      // 防护拦截同样计一次尝试（口径：每次验证提交计 1，仅通过不计）
      migrateProgress((p) => recordAttempt(p, submittedIndex));
    } finally {
      setJudging(false);
    }
  }

  function onReset() {
    setResult(null);
    setSqlInput("");
    setCurrentQuestionIndex(0);
    setPassFeedback(null); // 换会话后旧反馈条与倒计时不再有意义
    setSummaryOpen(false); // 旧会话的总结卡随换会话关闭
  }

  function onNewSession() {
    draftSaver.flushNow(); // 先把待写草稿落盘到旧会话的进度键，再换键
    regenerateSession();
    onReset();
    noPasteBannerShown.current = false; // 新会话可再弹一次禁粘贴规则提示
  }

  function onSwitchPack(targetPackId: string) {
    if (targetPackId === pack.packId) return;
    draftSaver.flushNow(); // 同上：落盘后再换键，避免草稿写进新会话
    setPack(targetPackId);
    onReset();
  }

  /** 切题：先落盘当前题待写草稿，再切换并恢复目标题已有草稿（issue #15）。
   *  草稿从 progressStore 实时快照读取（而非渲染闭包里的旧 进度）：
   *  防抖窗口内编辑→切题→切回时，落盘后的最新草稿才能被正确恢复。 */
  function switchQuestion(targetIndex: number) {
    draftSaver.flushNow();
    setCurrentQuestionIndex(targetIndex);
    setResult(null);
    setSqlInput(getDraft(progressStore.getSnapshot(), targetIndex));
  }

  /** 左栏题目目录行状态（同一级联两处查表共享）：当前 > 借助答案 > 通过 > 未做 */
  type QuestionRowState = "当前" | "借助" | "通过" | "未做";
  function rowState(i: number): QuestionRowState {
    if (i === currentQuestionIndex) return "当前";
    if (progress.assistedAnswerIndices.includes(i)) return "借助";
    if (progress.passedIndices.includes(i)) return "通过";
    return "未做";
  }
  // 行状态只靠小圆点：当前=墨 / 借助=紫 / 通过=绿 / 未做=空心
  const rowDotStyles: Record<QuestionRowState, string> = {
    当前: "bg-ink/55",
    借助: "bg-assist",
    通过: "bg-pass",
    未做: "bg-transparent ring-1 ring-ink/30",
  };
  const questionGroups: { knowledgeArea: string; indices: number[] }[] = [];
  for (let i = 0; i < session.questions.length; i++) {
    const knowledgeArea = session.questions[i].knowledgeArea;
    const lastGroup = questionGroups[questionGroups.length - 1];
    if (!lastGroup || lastGroup.knowledgeArea !== knowledgeArea) questionGroups.push({ knowledgeArea, indices: [i] });
    else lastGroup.indices.push(i);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-4 lg:px-6">
      {summaryOpen && session && (
        <SessionSummary
          tiers={completionTierStats(progress, session.questions.length)}
          completed={progress.passedIndices.length}
          total={session.questions.length}
          onPlayAgain={onNewSession}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="标题 text-[1.65rem] leading-none">SQL 演练场</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-ink/[0.06] p-0.5">
            {domainPackRegistry.map((d) => (
              <button
                key={d.packId}
                onClick={() => onSwitchPack(d.packId)}
                className={`rounded-full px-3 py-1 text-xs ${
                  d.packId === pack.packId
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
                style={{ width: `${total === 0 ? 0 : (completed / total) * 100}%` }}
              />
            </span>
            <span data-testid="完成度" className="font-mono text-xs text-muted">
              已完成 {completed}/{total}
            </span>
          </span>
          <button onClick={onNewSession} className="次按钮 px-3 py-1.5 text-xs">
            换一套（新种子）
          </button>
          <button
            onClick={() => setUserPanelToggle(!libraryBrowserOpen)}
            aria-expanded={libraryBrowserOpen}
            className={`次按钮 px-3 py-1.5 text-xs ${libraryBrowserOpen ? "ring-1 ring-ink/15" : ""}`}
          >
            表结构（Ctrl/⌘+B）
          </button>
        </div>
      </header>

      {/* 窄屏单列：题目 → 题面与编辑器 → 表结构 → 提示。桌面三栏并排。 */}
      <div className="flex flex-1 flex-col items-start gap-4 lg:flex-row">
        <aside className="入场 w-full shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-56 lg:overflow-y-auto">
          <nav className="卡片 横滑 flex gap-1 overflow-x-auto p-2 lg:block lg:overflow-visible">
            <p className="hidden px-2 py-1.5 text-xs text-muted lg:block">题目 · {session.questions.length}</p>
            {questionGroups.map((group) => (
              <div key={group.knowledgeArea} className="flex shrink-0 items-center gap-1 lg:mb-1 lg:block">
                <p className="hidden px-2 pt-2 pb-1 text-[11px] font-medium text-muted lg:block">
                  {group.knowledgeArea}
                </p>
                {group.indices.map((i) => {
                  const state = rowState(i);
                  return (
                    <button
                      key={i}
                      title={`${session.questions[i].knowledgeArea}（难度 ${session.questions[i].difficulty}）`}
                      onClick={() => switchQuestion(i)}
                      className={`flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs lg:w-full ${
                        state === "当前"
                          ? "bg-ink/[0.06] font-medium text-ink"
                          : "text-ink hover:bg-ink/[0.04]"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${rowDotStyles[state]}`} />
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
                {question.knowledgeArea}
              </span>
              {usedAnswerAssistance(progress, currentQuestionIndex) && (
                <span className="rounded-full bg-assist/10 px-2.5 py-0.5 font-medium text-assist">
                  已借助答案
                </span>
              )}
              <span className="ml-auto font-mono text-muted">
                第 {currentQuestionIndex + 1}/{session.questions.length} 题 · 难度{"★".repeat(question.difficulty)}
              </span>
            </p>
            <p className="text-[17px] leading-[1.75]">{question.prompt}</p>
          </section>

          <section className="space-y-3">
            {showNoPasteBanner && (
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
                    engineReady ? "text-pass" : "呼吸 text-warn"
                  }`}
                >
                  <i className="h-1.5 w-1.5 rounded-full bg-current" />
                  {engineReady ? "引擎就绪" : "引擎加载中"}
                </span>
              </div>
              <SqlEditor
                value={sqlInput}
                onChange={onEdit}
                onSubmit={verify}
                tables={session.database.tables}
                onInterceptPaste={notifyNoPaste}
              />
            </div>
            {!engineReady && (
              <p data-testid="引擎加载中" className="font-mono text-xs text-warn">
                数据库引擎（WASM）加载中……首次载入约需一两秒。
              </p>
            )}
            <div className="卡片 p-4">
              <p className="mb-3 text-xs font-medium text-muted">提示与答案</p>
              <HintsAndAnswer
                key={currentQuestionIndex}
                hints={question.hints}
                referenceAnswer={question.referenceAnswer}
                layersSeen={progress.hintsSeen[String(currentQuestionIndex)] ?? 0}
                usedAnswer={usedAnswerAssistance(progress, currentQuestionIndex)}
                unlockState={{
                  passed: isPassed(progress, currentQuestionIndex),
                  hintUnlocked: isHintUnlocked(progress, currentQuestionIndex),
                  answerUnlocked: isAnswerUnlocked(progress, currentQuestionIndex, answerExemption),
                  attemptCount: progress.attemptCounts[String(currentQuestionIndex)] ?? 0,
                }}
                attemptsToUnlock={attemptsToUnlockAnswer(progress, currentQuestionIndex, answerExemption)}
                answerExemption={answerExemption}
                onRevealHint={() => migrateProgress((p) => revealNextHintLayer(p, currentQuestionIndex)[0])}
                onViewAnswer={() => migrateProgress((p) => viewAnswer(p, currentQuestionIndex, answerExemption)[0])}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={verify}
                disabled={judging || sqlInput.trim().length === 0}
                className="主按钮 px-5 py-2 text-sm"
              >
                {judging ? "判定中……" : "验证"}
              </button>
              <span className="text-xs text-muted">
                Ctrl/⌘ + Enter 快速验证{judging ? "（判定在后台进行，可继续编辑或切换题目）" : ""}
              </span>
            </div>
          </section>

          {result && (
            <section className="入场 space-y-3">
              {result.judge === "通过" && (
                <p className="落章 卡片 border-l-4 border-l-pass px-4 py-2.5 font-medium text-pass">
                  通过！结果集与预期等价。
                </p>
              )}
              {result.judge === "通过" && passFeedback && (
                <div
                  data-testid="通过反馈条"
                  className="卡片 入场 flex flex-wrap items-center gap-3 border-l-4 border-l-pass px-4 py-2.5 text-sm"
                >
                  {passFeedback.targetIndex === null ? (
                    <span className="font-medium text-pass">全部题目已通过！</span>
                  ) : (
                    <>
                      <span className="text-ink">
                        {passFeedback.countingDown
                          ? `即将进入第 ${passFeedback.targetIndex + 1} 题（继续编辑可留下）……`
                          : `下一道未通过：第 ${passFeedback.targetIndex + 1} 题`}
                      </span>
                      <button
                        data-testid="下一题按钮"
                        onClick={() => {
                          const target = passFeedback.targetIndex;
                          setPassFeedback(null);
                          if (target !== null) switchQuestion(target);
                        }}
                        className="主按钮 px-3 py-1 text-sm"
                      >
                        下一题 →
                      </button>
                    </>
                  )}
                </div>
              )}
              {result.judge === "拦截" && (
                <p className="卡片 border-l-4 border-l-warn px-4 py-2.5 text-warn">
                  {result.errorMessage}
                </p>
              )}
              {result.judge === "错误" && (
                <pre className="卡片 overflow-auto bg-deep p-3 font-mono text-sm leading-relaxed">
                  <span className="text-muted">mysql&gt; </span>
                  <span className="text-ink">{sqlInput}</span>
                  {"\n"}
                  <span className="text-fail">{result.errorMessage}</span>
                </pre>
              )}
              {result.judge === "不通过" && (
                <div className="space-y-3">
                  <p className="卡片 border-l-4 border-l-fail px-4 py-2.5 font-medium text-fail">
                    不通过：结果集与预期不等价，请对照两侧差异。
                  </p>
                  <DiffComparison
                    studentResult={result.studentResult}
                    expectedResult={result.expectedResult}
                    ordered={question.ordered}
                  />
                </div>
              )}
            </section>
          )}
        </main>

        {/* 右栏常挂载（保住表级折叠态），收起时整列让位、主区恢复全宽（spec 故事 28） */}
        <aside
          className={`入场 入场-3 flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:max-h-[calc(100vh-2rem)] lg:min-h-0 lg:overflow-hidden ${
            libraryBrowserOpen ? "lg:w-[22rem]" : "lg:w-0 lg:gap-0 lg:border-0"
          }`}
        >
          <LibraryBrowser
            tables={session.database.tables}
            instanceLabel={instanceLabel(session.seed)}
            open={libraryBrowserOpen}
            onClose={closeLibraryBrowser}
          />
          {libraryBrowserOpen && (
            <p className="shrink-0 px-1 font-mono text-[11px] text-muted">会话种子 {session.seed}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
