// 会话进度的纯函数状态机：通过题号、已看提示层级、已借助答案题号、按题尝试次数与 SQL 草稿（issue #9、#15、#16）。
// 状态为不可变值，迁移函数返回新状态；持久化由调用方按 progressKey 写入 localStorage。

export interface ProgressRecord {
  /** 已判定通过的题号（0 起） */
  passedIndices: number[];
  /** 题号 → 已揭示的提示层数（1 或 2） */
  hintsSeen: Record<string, number>;
  /** 已查看过参考答案的题号（0 起），通过前查看才记入（语义收紧，issue #16） */
  assistedAnswerIndices: number[];
  /** 题号 → 验证提交次数（口径：不通过/错误/拦截均计，通过不计） */
  attemptCounts: Record<string, number>;
  /** 题号 → SQL 草稿文本（issue #15）：切题保留、随会话（域包+种子）持久 */
  drafts: Record<string, string>;
}

export const emptyProgress: ProgressRecord = {
  passedIndices: [],
  hintsSeen: {},
  assistedAnswerIndices: [],
  attemptCounts: {},
  drafts: {},
};

/** 进度随会话（域包 + 种子）持久：换一套或换域包即换键，等价于重置 */
export function progressKey(packId: string, seed: number): string {
  return `sql-playground:progress:${packId}:${seed}`;
}

/** 记一次验证提交尝试（口径：不通过/错误/拦截均计；通过的提交由调用方不记，issue #16） */
export function recordAttempt(progress: ProgressRecord, questionIndex: number): ProgressRecord {
  const count = (progress.attemptCounts[String(questionIndex)] ?? 0) + 1;
  return { ...progress, attemptCounts: { ...progress.attemptCounts, [String(questionIndex)]: count } };
}

/** 题号 i 是否已通过 */
export function isPassed(progress: ProgressRecord, questionIndex: number): boolean {
  return progress.passedIndices.includes(questionIndex);
}

/** 提示解锁门槛（ADR-0003 摩擦力）：该题尝试 ≥1；已通过的题全解锁 */
export function isHintUnlocked(progress: ProgressRecord, questionIndex: number): boolean {
  if (isPassed(progress, questionIndex)) return true;
  return (progress.attemptCounts[String(questionIndex)] ?? 0) >= 1;
}

/**
 * 答案解锁门槛：不通过尝试累计 ≥3，或已看提示且尝试 ≥2；已通过的题全解锁。
 * 豁免（T5，ADR-0003 修订 v3）：持「随时查看参考答案」权限点者免门槛直接解锁；
 * 缺省 false，学生路径零变化。
 */
export function isAnswerUnlocked(progress: ProgressRecord, questionIndex: number, exempt = false): boolean {
  if (exempt) return true;
  if (isPassed(progress, questionIndex)) return true;
  const attempts = progress.attemptCounts[String(questionIndex)] ?? 0;
  if (attempts >= 3) return true;
  const hintSeen = progress.hintsSeen[String(questionIndex)] ?? 0;
  return hintSeen >= 1 && attempts >= 2;
}

/**
 * 距答案解锁还差的尝试次数（口径与 isAnswerUnlocked 一致）：
 * 已通过或已解锁返回 0；否则按门槛（已看提示 ≥1 层为 2 次，否则 3 次）减去已有尝试。
 * 门槛知识归本模块单一来源，UI 只展示不重述。
 */
export function attemptsToUnlockAnswer(progress: ProgressRecord, questionIndex: number, exempt = false): number {
  if (isAnswerUnlocked(progress, questionIndex, exempt)) return 0;
  const attempts = progress.attemptCounts[String(questionIndex)] ?? 0;
  const hintSeen = progress.hintsSeen[String(questionIndex)] ?? 0;
  const threshold = hintSeen >= 1 ? 2 : 3;
  return Math.max(0, threshold - attempts);
}

/** 记录第 i 题通过（幂等） */
export function recordPass(progress: ProgressRecord, questionIndex: number): ProgressRecord {
  if (progress.passedIndices.includes(questionIndex)) return progress;
  return { ...progress, passedIndices: [...progress.passedIndices, questionIndex].sort((a, b) => a - b) };
}

/** 揭示第 questionIndex 题的下一层提示：返回 [新进度, 揭示到的层数]（已到顶层则不变） */
export function revealNextHintLayer(progress: ProgressRecord, questionIndex: number): [ProgressRecord, number] {
  const hintSeen = progress.hintsSeen[String(questionIndex)] ?? 0;
  if (hintSeen >= 2) return [progress, 2];
  const nextLayer = hintSeen + 1;
  return [{ ...progress, hintsSeen: { ...progress.hintsSeen, [String(questionIndex)]: nextLayer } }, nextLayer];
}

/**
 * 从当前题号向后环形查找第一个未通过的题（issue #18 T7）：
 * 跳着做题不遗漏（绕回题首），任意做题顺序都收敛；全部通过返回 null。
 */
export function nextUnpassedQuestion(progress: ProgressRecord, currentIndex: number, totalQuestions: number): number | null {
  for (let step = 1; step <= totalQuestions; step++) {
    const questionIndex = (currentIndex + step) % totalQuestions;
    if (!progress.passedIndices.includes(questionIndex)) return questionIndex;
  }
  return null;
}

/** 完成度：x/总题数 */
export function completion(progress: ProgressRecord, totalQuestions: number): { completed: number; total: number } {
  return { completed: progress.passedIndices.length, total: totalQuestions };
}

/**
 * 完成分档统计（issue #19 T8，GLOSSARY「完成分档」）：只统计通过题，每道恰好一档——
 * 借助答案（通过前查看，语义由 viewAnswer 收紧保证）＞借助提示（看过提示层）＞独立完成。
 */
export function completionTierStats(
  progress: ProgressRecord,
  totalQuestions: number,
): { independent: number; withHints: number; withAnswer: number } {
  let independent = 0;
  let withHints = 0;
  let withAnswer = 0;
  for (let questionIndex = 0; questionIndex < totalQuestions; questionIndex++) {
    if (!progress.passedIndices.includes(questionIndex)) continue;
    if (progress.assistedAnswerIndices.includes(questionIndex)) withAnswer++;
    else if ((progress.hintsSeen[String(questionIndex)] ?? 0) >= 1) withHints++;
    else independent++;
  }
  return { independent, withHints, withAnswer };
}

/**
 * 查看参考答案（ADR-0003 语义收紧）：通过前查看记入"已借助答案"并挂徽章，
 * 通过后查看仅展示不记录。返回 [新进度, 是否记入借助]。
 * 豁免（T5，ADR-0003 修订 v3）：持「随时查看参考答案」权限点者的查看属教学检视，
 * 不写入「已借助答案」、不计完成分档——进度原样返回。
 */
export function viewAnswer(progress: ProgressRecord, questionIndex: number, exempt = false): [ProgressRecord, boolean] {
  if (exempt) return [progress, false];
  if (isPassed(progress, questionIndex)) return [progress, false];
  if (progress.assistedAnswerIndices.includes(questionIndex)) return [progress, true];
  return [{ ...progress, assistedAnswerIndices: [...progress.assistedAnswerIndices, questionIndex] }, true];
}

/** 记录第 questionIndex 题的 SQL 草稿（issue #15）：内容未变原样返回（幂等），空串清除该题草稿 */
export function saveDraft(progress: ProgressRecord, questionIndex: number, sql: string): ProgressRecord {
  const key = String(questionIndex);
  const existing = progress.drafts[key];
  if (sql === "") {
    if (existing === undefined) return progress;
    const newDrafts = { ...progress.drafts };
    delete newDrafts[key];
    return { ...progress, drafts: newDrafts };
  }
  if (existing === sql) return progress;
  return { ...progress, drafts: { ...progress.drafts, [key]: sql } };
}

/** 读取第 questionIndex 题的 SQL 草稿，无草稿回退空串 */
export function getDraft(progress: ProgressRecord, questionIndex: number): string {
  return progress.drafts[String(questionIndex)] ?? "";
}

/** 题号 i 是否已借助答案 */
export function usedAnswerAssistance(progress: ProgressRecord, questionIndex: number): boolean {
  return progress.assistedAnswerIndices.includes(questionIndex);
}

/**
 * 从 localStorage 的原始字符串解析进度，非法/缺字段时回退到空进度。
 * 纯函数化以便单测。
 */
export function parseProgress(raw: string | null): ProgressRecord {
  if (raw === null) return emptyProgress;
  try {
    const obj = JSON.parse(raw) as Partial<ProgressRecord>;
    if (
      !Array.isArray(obj.passedIndices) ||
      !obj.passedIndices.every((n) => Number.isInteger(n) && n >= 0)
    ) {
      return emptyProgress;
    }
    const assisted = Array.isArray(obj.assistedAnswerIndices)
      ? obj.assistedAnswerIndices.filter((n) => Number.isInteger(n) && n >= 0)
      : [];
    const hints: Record<string, number> = {};
    if (obj.hintsSeen && typeof obj.hintsSeen === "object") {
      for (const [k, v] of Object.entries(obj.hintsSeen)) {
        if (/^\d+$/.test(k) && (v === 1 || v === 2)) hints[k] = v;
      }
    }
    // 尝试次数为新增字段（issue #16）：旧数据缺失时回退为空记录
    const attempts: Record<string, number> = {};
    if (obj.attemptCounts && typeof obj.attemptCounts === "object") {
      for (const [k, v] of Object.entries(obj.attemptCounts)) {
        if (/^\d+$/.test(k) && Number.isInteger(v) && v >= 0) attempts[k] = v;
      }
    }
    // 草稿向后兼容（issue #15）：旧数据缺字段回退空草稿，只收留数字题号→字符串条目
    const drafts: Record<string, string> = {};
    if (obj.drafts && typeof obj.drafts === "object") {
      for (const [k, v] of Object.entries(obj.drafts)) {
        if (/^\d+$/.test(k) && typeof v === "string") drafts[k] = v;
      }
    }
    return {
      passedIndices: obj.passedIndices as number[],
      assistedAnswerIndices: assisted,
      hintsSeen: hints,
      attemptCounts: attempts,
      drafts,
    };
  } catch {
    return emptyProgress;
  }
}
