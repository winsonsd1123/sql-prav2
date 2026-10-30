import { describe, expect, it } from "vitest";
import {
  emptyProgress,
  progressKey,
  parseProgress,
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

describe("进度状态机", () => {
  it("空进度完成度为 0", () => {
    expect(completion(emptyProgress, 8)).toEqual({ completed: 0, total: 8 });
  });

  it("记通过：追加且幂等，不影响原状态（不可变）", () => {
    const a = recordPass(emptyProgress, 2);
    const b = recordPass(a, 0);
    const c = recordPass(b, 2); // 重复通过
    expect(c.passedIndices).toEqual([0, 2]);
    expect(a.passedIndices).toEqual([2]); // 原 state 未被修改
    expect(completion(c, 8).completed).toBe(2);
  });

  it("提示逐层揭示：0→1→2→封顶", () => {
    const [p1, l1] = revealNextHintLayer(emptyProgress, 3);
    expect(l1).toBe(1);
    const [p2, l2] = revealNextHintLayer(p1, 3);
    expect(l2).toBe(2);
    const [p3, l3] = revealNextHintLayer(p2, 3);
    expect(l3).toBe(2);
    expect(p3).toBe(p2); // 已封顶则原样返回
    expect(p2.hintsSeen["3"]).toBe(2);
  });

  it("提示层数按题号隔离", () => {
    const [p1] = revealNextHintLayer(emptyProgress, 0);
    expect(p1.hintsSeen["1"]).toBeUndefined();
    expect(p1.hintsSeen["0"]).toBe(1);
  });

  it("借助答案语义由 查看答案 收紧保证：通过前记入且幂等（借助答案 迁移函数已随死代码移除）", () => {
    const [p] = viewAnswer(emptyProgress, 4);
    expect(usedAnswerAssistance(p, 4)).toBe(true);
    const [again] = viewAnswer(p, 4);
    expect(usedAnswerAssistance(again, 4)).toBe(true);
    expect(usedAnswerAssistance(p, 5)).toBe(false);
  });

  it("记草稿：按题号保存与覆盖，相同内容原样返回（幂等）", () => {
    const p1 = saveDraft(emptyProgress, 0, "SELECT 1");
    expect(getDraft(p1, 0)).toBe("SELECT 1");
    expect(getDraft(p1, 1)).toBe(""); // 其他题无草稿，回退空串
    const p2 = saveDraft(p1, 0, "SELECT 2");
    expect(getDraft(p2, 0)).toBe("SELECT 2"); // 覆盖
    const p3 = saveDraft(p2, 0, "SELECT 2");
    expect(p3).toBe(p2); // 内容未变则原样返回
    expect(getDraft(p1, 0)).toBe("SELECT 1"); // 原 state 未被修改
  });

  it("记草稿：空串清除该题草稿（不留空串残迹）", () => {
    const p1 = saveDraft(emptyProgress, 3, "SELECT 1");
    const p2 = saveDraft(p1, 3, "");
    expect(getDraft(p2, 3)).toBe("");
    expect(p2.drafts["3"]).toBeUndefined();
  });

  it("草稿按题号隔离：互不干扰", () => {
    const p = saveDraft(saveDraft(emptyProgress, 1, "SELECT a"), 2, "SELECT b");
    expect(getDraft(p, 1)).toBe("SELECT a");
    expect(getDraft(p, 2)).toBe("SELECT b");
  });

  it("进度键随域包与种子区分（换一套/换域包即换键）", () => {
    expect(progressKey("packA", 1)).not.toBe(progressKey("packA", 2));
    expect(progressKey("packA", 1)).not.toBe(progressKey("packB", 1));
  });

  it("解析进度：合法 JSON 还原（含草稿）；非法回退空进度", () => {
    const original = saveDraft(viewAnswer(recordPass(revealNextHintLayer(emptyProgress, 1)[0], 0), 1)[0], 2, "SELECT c");
    expect(parseProgress(JSON.stringify(original))).toEqual(original);
    expect(parseProgress(null)).toEqual(emptyProgress);
    expect(parseProgress("不是JSON")).toEqual(emptyProgress);
    expect(parseProgress('{"passedIndices":[1,-2]}')).toEqual(emptyProgress);
    expect(parseProgress('{"passedIndices":[0],"hintsSeen":{"x":1,"1":9},"assistedAnswerIndices":[3]}')).toEqual({
      passedIndices: [0],
      hintsSeen: {},
      assistedAnswerIndices: [3],
      attemptCounts: {},
      drafts: {},
    });
  });

  it("解析进度：旧数据缺草稿字段回退为空草稿（向后兼容）", () => {
    const legacyData = '{"passedIndices":[0],"hintsSeen":{"0":1},"assistedAnswerIndices":[]}';
    const p = parseProgress(legacyData);
    expect(p).toEqual({ passedIndices: [0], hintsSeen: { "0": 1 }, assistedAnswerIndices: [], attemptCounts: {}, drafts: {} });
    expect(getDraft(p, 0)).toBe("");
  });

  it("解析进度：草稿字段只收留数字题号→字符串的条目", () => {
    const p = parseProgress(
      '{"passedIndices":[],"hintsSeen":{},"assistedAnswerIndices":[],"drafts":{"1":"SELECT 1","x":"SELECT x","2":3,"3":"SELECT 3"}}',
    );
    expect(p.drafts).toEqual({ "1": "SELECT 1", "3": "SELECT 3" });
  });
});

describe("环形查找下一未通过题（issue #18 T7）", () => {
  /** 预置一份 10 题进度：已通过的题号集合，其余未做 */
  const tenQuestionProgress = (passed: number[]) =>
    passed.reduce((p, i) => recordPass(p, i), emptyProgress);

  it("顺延：紧邻的下一题未通过则直接返回下一题号", () => {
    expect(nextUnpassedQuestion(tenQuestionProgress([0]), 0, 10)).toBe(1);
    expect(nextUnpassedQuestion(emptyProgress, 5, 10)).toBe(6);
  });

  it("跳题反例：0-5 与 7-9 已通过、6 未做——从任意位置查都命中 6，不遗漏也不误判", () => {
    const p = tenQuestionProgress([0, 1, 2, 3, 4, 5, 7, 8, 9]);
    expect(nextUnpassedQuestion(p, 0, 10)).toBe(6); // 向后跨过已通过题
    expect(nextUnpassedQuestion(p, 3, 10)).toBe(6);
    expect(nextUnpassedQuestion(p, 5, 10)).toBe(6);
    expect(nextUnpassedQuestion(p, 7, 10)).toBe(6); // 从 6 之后出发需绕回题首
    expect(nextUnpassedQuestion(p, 9, 10)).toBe(6); // 尾部出发绕回
  });

  it("环形绕回：尾部与头部都有未通过题时，只绕回到最近的头部未通过题", () => {
    const p = tenQuestionProgress([2, 3, 4, 5]);
    expect(nextUnpassedQuestion(p, 6, 10)).toBe(7); // 中部直接顺延
    expect(nextUnpassedQuestion(p, 8, 10)).toBe(9);
    expect(nextUnpassedQuestion(p, 9, 10)).toBe(0); // 尾部绕回到题首最近的未通过题
    expect(nextUnpassedQuestion(p, 1, 10)).toBe(6); // 头部出发跨过中部已通过带
  });

  it("全部通过返回 null（会话完成，不跳转）", () => {
    const p = tenQuestionProgress([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(nextUnpassedQuestion(p, 3, 10)).toBeNull();
    expect(nextUnpassedQuestion(p, 9, 10)).toBeNull();
  });

  it("当前题号即唯一未通过题时绕回自身（当前题刚通过的场景由调用方保证，此处验证环形完备性）", () => {
    expect(nextUnpassedQuestion(emptyProgress, 4, 5)).toBe(0); // 其余全未通过时从最近处开始
    const onlyUnpassed = tenQuestionProgress([0, 1, 2, 3]);
    expect(nextUnpassedQuestion(onlyUnpassed, 4, 5)).toBe(4); // 绕回当前题自身
  });
});

describe("两级解锁（issue #16，ADR-0003 摩擦力设计）", () => {
  const attemptN = (progress: typeof emptyProgress, questionIndex: number, times: number) =>
    Array.from({ length: times }, (_, i) => i).reduce((p) => recordAttempt(p, questionIndex), progress);

  it("尝试口径：记尝试逐次累加，按题号隔离", () => {
    const p = attemptN(emptyProgress, 0, 3);
    expect(p.attemptCounts["0"]).toBe(3);
    expect(p.attemptCounts["1"]).toBeUndefined();
  });

  it("提示门槛：0 次尝试锁定，1 次即解锁", () => {
    expect(isHintUnlocked(emptyProgress, 0)).toBe(false);
    expect(isHintUnlocked(attemptN(emptyProgress, 0, 1), 0)).toBe(true);
  });

  it("答案门槛：不通过尝试累计 3 次解锁", () => {
    expect(isAnswerUnlocked(attemptN(emptyProgress, 0, 2), 0)).toBe(false);
    expect(isAnswerUnlocked(attemptN(emptyProgress, 0, 3), 0)).toBe(true);
  });

  it("答案门槛：已看提示且尝试 ≥2 即解锁（看过提示后再试 1 次的口径）", () => {
    const hintThenAttempt = recordAttempt(revealNextHintLayer(attemptN(emptyProgress, 0, 1), 0)[0], 0);
    expect(isAnswerUnlocked(hintThenAttempt, 0)).toBe(true);
    const attemptOnceThenHint = revealNextHintLayer(attemptN(emptyProgress, 0, 1), 0)[0];
    expect(isAnswerUnlocked(attemptOnceThenHint, 0)).toBe(false);
  });

  it("答案解锁还差尝试：未看过提示门槛 3 次，已看过提示门槛降为 2 次", () => {
    expect(attemptsToUnlockAnswer(emptyProgress, 0)).toBe(3);
    expect(attemptsToUnlockAnswer(attemptN(emptyProgress, 0, 1), 0)).toBe(2);
    const hintSeen = revealNextHintLayer(attemptN(emptyProgress, 0, 1), 0)[0];
    expect(attemptsToUnlockAnswer(hintSeen, 0)).toBe(1); // 已看提示且已有 1 次尝试，还差 1 次
  });

  it("答案解锁还差尝试：恰达门槛或已通过/已解锁返回 0（口径与 答案是否解锁 一致）", () => {
    expect(attemptsToUnlockAnswer(attemptN(emptyProgress, 0, 3), 0)).toBe(0);
    expect(isAnswerUnlocked(attemptN(emptyProgress, 0, 3), 0)).toBe(true);
    const passed = recordPass(emptyProgress, 5);
    expect(attemptsToUnlockAnswer(passed, 5)).toBe(0);
    expect(attemptsToUnlockAnswer(attemptN(emptyProgress, 0, 9), 0)).toBe(0); // 超额尝试不出现负数
  });

  it("已通过的题提示与答案全解锁", () => {
    const passed = recordPass(emptyProgress, 5);
    expect(isHintUnlocked(passed, 5)).toBe(true);
    expect(isAnswerUnlocked(passed, 5)).toBe(true);
    expect(isPassed(passed, 5)).toBe(true);
  });

  it("借助答案语义收紧：通过前查看记入，通过后查看不记", () => {
    const unpassedUnlocked = attemptN(emptyProgress, 0, 3);
    const [beforeView, recordedBefore] = viewAnswer(unpassedUnlocked, 0);
    expect(recordedBefore).toBe(true);
    expect(usedAnswerAssistance(beforeView, 0)).toBe(true);

    const passedProgress = recordPass(emptyProgress, 1);
    const [afterView, recordedAfter] = viewAnswer(passedProgress, 1);
    expect(recordedAfter).toBe(false);
    expect(usedAnswerAssistance(afterView, 1)).toBe(false);
  });

  it("解析进度：缺尝试次数字段回退为空记录（旧数据兼容）", () => {
    const legacyData = '{"passedIndices":[0],"hintsSeen":{"1":2},"assistedAnswerIndices":[3]}';
    expect(parseProgress(legacyData)).toEqual({
      passedIndices: [0],
      hintsSeen: { "1": 2 },
      assistedAnswerIndices: [3],
      attemptCounts: {},
      drafts: {},
    });
    const newData = JSON.stringify(attemptN(recordPass(emptyProgress, 2), 1, 4));
    expect(parseProgress(newData)).toEqual(parseProgress(newData));
    expect(parseProgress(newData).attemptCounts["1"]).toBe(4);
  });

  it("完成分档：全部独立完成", () => {
    const progress = { ...emptyProgress, passedIndices: [0, 1, 2] };
    expect(completionTierStats(progress, 3)).toEqual({
      independent: 3,
      withHints: 0,
      withAnswer: 0,
    });
  });

  it("完成分档：三档混合，每道通过题恰好一档（答案优先于提示）", () => {
    const progress = {
      ...emptyProgress,
      passedIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      hintsSeen: { "1": 2, "2": 1, "9": 2 }, // 题 9 同时借助答案 → 归答案档
      assistedAnswerIndices: [7, 9],
    };
    expect(completionTierStats(progress, 10)).toEqual({
      independent: 6, // 0,3,4,5,6,8
      withHints: 2, // 1,2
      withAnswer: 2, // 7,9
    });
  });

  it("完成分档：只统计通过题——未通过但已借助答案/看过提示的不计入任何档", () => {
    const progress = {
      ...emptyProgress,
      passedIndices: [0],
      hintsSeen: { "1": 2, "2": 1 },
      assistedAnswerIndices: [1, 3], // 题 1/3 未通过
    };
    expect(completionTierStats(progress, 4)).toEqual({
      independent: 1,
      withHints: 0, // 题 2 看过提示但未通过，不计
      withAnswer: 0,
    });
  });
});

describe("参考答案豁免（T5 / ADR-0003 修订 v3：教学检视不构成「借助答案」）", () => {
  it("持「随时查看参考答案」者：0 尝试也解锁，答案还差尝试为 0", () => {
    expect(isAnswerUnlocked(emptyProgress, 0, true)).toBe(true);
    expect(attemptsToUnlockAnswer(emptyProgress, 0, true)).toBe(0);
  });

  it("豁免查看不写入「已借助答案」：进度原样返回、不记入借助", () => {
    const [progress, recorded] = viewAnswer(emptyProgress, 0, true);
    expect(recorded).toBe(false);
    expect(progress).toBe(emptyProgress); // 不可变且零变化（学生路径行为零变化的安全对偶）
    expect(usedAnswerAssistance(progress, 0)).toBe(false);
  });

  it("豁免查看幂等：反复查看仍不记录", () => {
    const [p1] = viewAnswer(emptyProgress, 3, true);
    const [p2, recorded] = viewAnswer(p1, 3, true);
    expect(recorded).toBe(false);
    expect(p2).toBe(p1);
  });

  it("豁免×分档组合：教师看答案后无提示通过 → 独立完成", () => {
    let progress = emptyProgress;
    [progress] = viewAnswer(progress, 0, true); // 教学检视
    progress = recordPass(progress, 0);
    expect(completionTierStats(progress, 1)).toEqual({ independent: 1, withHints: 0, withAnswer: 0 });
  });

  it("豁免×分档组合：教师看答案后看提示通过 → 借助提示（豁免不吞掉提示档）", () => {
    let progress = emptyProgress;
    [progress] = viewAnswer(progress, 0, true);
    [progress] = revealNextHintLayer(progress, 0);
    progress = recordPass(progress, 0);
    expect(completionTierStats(progress, 1)).toEqual({ independent: 0, withHints: 1, withAnswer: 0 });
  });

  it("学生路径零变化：不传豁免（默认 false）时门槛与记录语义与既有行为一致", () => {
    expect(isAnswerUnlocked(emptyProgress, 0)).toBe(false);
    expect(isAnswerUnlocked(emptyProgress, 0, false)).toBe(false);
    const [progress, recorded] = viewAnswer(emptyProgress, 0, false);
    expect(recorded).toBe(true);
    expect(usedAnswerAssistance(progress, 0)).toBe(true);
  });

  it("学生通过前看答案仍计「借助答案」档（豁免不外溢）", () => {
    let progress = emptyProgress;
    [progress] = viewAnswer(progress, 0); // 无豁免：记入
    progress = recordPass(progress, 0);
    expect(completionTierStats(progress, 1)).toEqual({ independent: 0, withHints: 0, withAnswer: 1 });
  });
});
