// T6 · 进度上云同步策略纯函数（issue #28）：本地与云进度合并规则、
// 判定后节流合并写、断网积压与恢复冲写的状态机。只测模块边界行为，不测实现细节。
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  合并进度,
  创建进度节流器,
  初始同步状态,
  同步状态机,
} from "@/lib/进度同步";
import { 空进度, 记通过, 记尝试, 记草稿, type 进度记录 } from "@/components/进度";

const 本地一条 = {
  ...空进度,
  已通过题号: [1],
  尝试次数: { "1": 2 },
  草稿: { "1": "SELECT 本地" },
};

const 云端一条 = {
  ...空进度,
  已通过题号: [3],
  已看提示: { "3": 1 },
  尝试次数: { "3": 4 },
  草稿: { "3": "SELECT 云端" },
};

describe("合并进度（云端为准、同键覆盖）", () => {
  it("两侧并集保留，互不丢题", () => {
    const 合 = 合并进度(本地一条, 云端一条);
    expect(合.已通过题号).toEqual([1, 3]);
    expect(合.草稿["1"]).toBe("SELECT 本地");
    expect(合.草稿["3"]).toBe("SELECT 云端");
  });

  it("同键冲突时云端覆盖本地", () => {
    const 本地 = { ...本地一条, 尝试次数: { "1": 5, "2": 1 }, 已看提示: { "2": 2 } };
    const 云端 = { ...云端一条, 尝试次数: { "1": 2, "2": 7 }, 已看提示: { "2": 1 } };
    const 合 = 合并进度(本地, 云端);
    expect(合.尝试次数["1"]).toBe(2);
    expect(合.尝试次数["2"]).toBe(7);
    expect(合.已看提示["2"]).toBe(1);
  });

  it("云端为空记录时保留本地（云端无该会话数据不作清空）", () => {
    const 合 = 合并进度(本地一条, 空进度);
    expect(合).toEqual(本地一条);
  });

  it("已借助答案取并集（语义标记不可因合并丢失）", () => {
    const 合 = 合并进度(
      { ...空进度, 已借助答案题号: [0] },
      { ...空进度, 已借助答案题号: [2] },
    );
    expect(合.已借助答案题号).toEqual([0, 2]);
  });

  it("不可变：不修改入参", () => {
    const 本地副本 = JSON.parse(JSON.stringify(本地一条)) as 进度记录;
    const 云端副本 = JSON.parse(JSON.stringify(云端一条)) as 进度记录;
    合并进度(本地一条, 云端一条);
    expect(本地一条).toEqual(本地副本);
    expect(云端一条).toEqual(云端副本);
  });
});

describe("创建进度节流器（判定后约 3 秒静默合并写）", () => {
  afterEach(() => vi.useRealTimers());

  it("窗口内多次判定只压一次写，载荷为最新进度", () => {
    vi.useFakeTimers();
    const 写入 = vi.fn();
    const 节流器 = 创建进度节流器(写入, 3000);
    let p = 记尝试(空进度, 0);
    节流器.排程(p);
    p = 记尝试(p, 0);
    节流器.排程(p);
    p = 记通过(p, 0);
    节流器.排程(p);
    expect(写入).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2999);
    expect(写入).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(写入).toHaveBeenCalledTimes(1);
    expect(写入).toHaveBeenCalledWith(p);
  });

  it("首个判定即起算窗口，后续判定不重置截止时刻（节流非防抖）", () => {
    vi.useFakeTimers();
    const 写入 = vi.fn();
    const 节流器 = 创建进度节流器(写入, 3000);
    节流器.排程(记尝试(空进度, 0));
    vi.advanceTimersByTime(2000);
    节流器.排程(记草稿(空进度, 1, "SELECT 二秒")); // 窗口后半段的新判定
    vi.advanceTimersByTime(1000); // 距首个判定 3 秒，应已写
    expect(写入).toHaveBeenCalledTimes(1);
  });

  it("窗口结束后的新判定开启新窗口", () => {
    vi.useFakeTimers();
    const 写入 = vi.fn();
    const 节流器 = 创建进度节流器(写入, 3000);
    节流器.排程(记尝试(空进度, 0));
    vi.advanceTimersByTime(3000);
    节流器.排程(记尝试(空进度, 1));
    expect(写入).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(写入).toHaveBeenCalledTimes(2);
  });

  it("立即冲写：窗口未到也立刻落一次最新值，且不再重复写", () => {
    vi.useFakeTimers();
    const 写入 = vi.fn();
    const 节流器 = 创建进度节流器(写入, 3000);
    const p = 记通过(空进度, 2);
    节流器.排程(p);
    节流器.立即冲写();
    expect(写入).toHaveBeenCalledWith(p);
    vi.advanceTimersByTime(3000);
    expect(写入).toHaveBeenCalledTimes(1); // 冲写后计时器取消
  });

  it("无待写时立即冲写不产生写入", () => {
    const 写入 = vi.fn();
    创建进度节流器(写入, 3000).立即冲写();
    expect(写入).not.toHaveBeenCalled();
  });
});

describe("同步状态机（断网积压 → 恢复冲写）", () => {
  it("判定写入从空闲进入待写并给出安排节流动作", () => {
    const [状态, 动作] = 同步状态机(初始同步状态(), { 类型: "判定写入", 时刻: 1000 });
    expect(状态).toEqual({ 阶段: "待写", 窗口起点: 1000, 重试次数: 0 });
    expect(动作).toBe("安排节流写");
  });

  it("待写期间的判定不重开窗口、无新动作", () => {
    const 待写 = 同步状态机(初始同步状态(), { 类型: "判定写入", 时刻: 1000 })[0];
    const [状态, 动作] = 同步状态机(待写, { 类型: "判定写入", 时刻: 2500 });
    expect(状态).toEqual(待写);
    expect(动作).toBe("无");
  });

  it("节流到期转写中；写成功回空闲；成功后的新判定重新起窗", () => {
    const 待写 = 同步状态机(初始同步状态(), { 类型: "判定写入", 时刻: 0 })[0];
    const 写中 = 同步状态机(待写, { 类型: "节流到期", 时刻: 3000 })[0];
    expect(写中.阶段).toBe("写中");
    const [空闲, 动作] = 同步状态机(写中, { 类型: "写成功" });
    expect(空闲.阶段).toBe("空闲");
    expect(动作).toBe("无");
    const 再写 = 同步状态机(空闲, { 类型: "判定写入", 时刻: 5000 });
    expect(再写[0].阶段).toBe("待写");
  });

  it("写失败转积压并按退避安排重试；重试成功清积压", () => {
    const 待写 = 同步状态机(初始同步状态(), { 类型: "判定写入", 时刻: 0 })[0];
    const 写中 = 同步状态机(待写, { 类型: "节流到期", 时刻: 3000 })[0];
    const [积压, 动作] = 同步状态机(写中, { 类型: "写失败", 时刻: 3100 });
    expect(积压.阶段).toBe("积压");
    expect(积压.重试次数).toBe(1);
    expect(动作).toBe("安排重试");
    // 重试又失败：退避翻倍
    const 重试中 = 同步状态机(积压, { 类型: "重试时刻到" })[0];
    expect(重试中.阶段).toBe("写中");
    const [积压2, 动作2] = 同步状态机(重试中, { 类型: "写失败", 时刻: 10000 });
    expect(积压2.重试次数).toBe(2);
    expect(动作2).toBe("安排重试");
    const 重试中2 = 同步状态机(积压2, { 类型: "重试时刻到" })[0];
    const [空闲, 动作3] = 同步状态机(重试中2, { 类型: "写成功" });
    expect(空闲.阶段).toBe("空闲");
    expect(空闲.重试次数).toBe(0);
    expect(动作3).toBe("无");
  });

  it("积压期间新判定仍并入待写载荷（不重开重试计时），恢复在线立即冲写", () => {
    let [积压] = 同步状态机(初始同步状态(), { 类型: "判定写入", 时刻: 0 });
    积压 = 同步状态机(积压, { 类型: "节流到期", 时刻: 3000 })[0];
    积压 = 同步状态机(积压, { 类型: "写失败", 时刻: 3100 })[0];
    const [状态, 动作] = 同步状态机(积压, { 类型: "判定写入", 时刻: 4000 });
    expect(状态).toEqual(积压); // 状态不变，载荷由调用方合并
    expect(动作).toBe("无");
    const [写中, 动作2] = 同步状态机(积压, { 类型: "恢复在线", 时刻: 4500 });
    expect(写中.阶段).toBe("写中");
    expect(动作2).toBe("无"); // 状态机已转入写中，实际写由监听方执行
  });

  it("写中收到判定写入保持写中（写完由 节流到期/写成功 流转）", () => {
    const 待写 = 同步状态机(初始同步状态(), { 类型: "判定写入", 时刻: 0 })[0];
    const 写中 = 同步状态机(待写, { 类型: "节流到期", 时刻: 3000 })[0];
    const [状态, 动作] = 同步状态机(写中, { 类型: "判定写入", 时刻: 3200 });
    expect(状态.阶段).toBe("写中");
    expect(动作).toBe("无");
  });
});
