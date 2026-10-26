import { describe, expect, it } from "vitest";
import {
  空进度,
  进度键,
  解析进度,
  记通过,
  记尝试,
  揭示下一层提示,
  借助答案,
  查看答案,
  完成度,
  是否借助答案,
  是否已通过,
  提示是否解锁,
  答案是否解锁,
} from "@/components/进度";

describe("进度状态机", () => {
  it("空进度完成度为 0", () => {
    expect(完成度(空进度, 8)).toEqual({ 已完成: 0, 总数: 8 });
  });

  it("记通过：追加且幂等，不影响原状态（不可变）", () => {
    const a = 记通过(空进度, 2);
    const b = 记通过(a, 0);
    const c = 记通过(b, 2); // 重复通过
    expect(c.已通过题号).toEqual([0, 2]);
    expect(a.已通过题号).toEqual([2]); // 原 state 未被修改
    expect(完成度(c, 8).已完成).toBe(2);
  });

  it("提示逐层揭示：0→1→2→封顶", () => {
    const [p1, l1] = 揭示下一层提示(空进度, 3);
    expect(l1).toBe(1);
    const [p2, l2] = 揭示下一层提示(p1, 3);
    expect(l2).toBe(2);
    const [p3, l3] = 揭示下一层提示(p2, 3);
    expect(l3).toBe(2);
    expect(p3).toBe(p2); // 已封顶则原样返回
    expect(p2.已看提示["3"]).toBe(2);
  });

  it("提示层数按题号隔离", () => {
    const [p1] = 揭示下一层提示(空进度, 0);
    expect(p1.已看提示["1"]).toBeUndefined();
    expect(p1.已看提示["0"]).toBe(1);
  });

  it("借助答案：标注且幂等", () => {
    const p = 借助答案(空进度, 4);
    expect(是否借助答案(p, 4)).toBe(true);
    expect(是否借助答案(借助答案(p, 4), 4)).toBe(true);
    expect(是否借助答案(p, 5)).toBe(false);
  });

  it("进度键随域包与种子区分（换一套/换域包即换键）", () => {
    expect(进度键("packA", 1)).not.toBe(进度键("packA", 2));
    expect(进度键("packA", 1)).not.toBe(进度键("packB", 1));
  });

  it("解析进度：合法 JSON 还原；非法回退空进度", () => {
    const 原 = 借助答案(记通过(揭示下一层提示(空进度, 1)[0], 0), 1);
    expect(解析进度(JSON.stringify(原))).toEqual(原);
    expect(解析进度(null)).toEqual(空进度);
    expect(解析进度("不是JSON")).toEqual(空进度);
    expect(解析进度('{"已通过题号":[1,-2]}')).toEqual(空进度);
    expect(解析进度('{"已通过题号":[0],"已看提示":{"x":1,"1":9},"已借助答案题号":[3]}')).toEqual({
      已通过题号: [0],
      已看提示: {},
      已借助答案题号: [3],
      尝试次数: {},
    });
  });
});

describe("两级解锁（issue #16，ADR-0003 摩擦力设计）", () => {
  const 试 = (进度: typeof 空进度, 题号: number, 次数: number) =>
    Array.from({ length: 次数 }, (_, i) => i).reduce((p) => 记尝试(p, 题号), 进度);

  it("尝试口径：记尝试逐次累加，按题号隔离", () => {
    const p = 试(空进度, 0, 3);
    expect(p.尝试次数["0"]).toBe(3);
    expect(p.尝试次数["1"]).toBeUndefined();
  });

  it("提示门槛：0 次尝试锁定，1 次即解锁", () => {
    expect(提示是否解锁(空进度, 0)).toBe(false);
    expect(提示是否解锁(试(空进度, 0, 1), 0)).toBe(true);
  });

  it("答案门槛：不通过尝试累计 3 次解锁", () => {
    expect(答案是否解锁(试(空进度, 0, 2), 0)).toBe(false);
    expect(答案是否解锁(试(空进度, 0, 3), 0)).toBe(true);
  });

  it("答案门槛：已看提示且尝试 ≥2 即解锁（看过提示后再试 1 次的口径）", () => {
    const 看过提示后再试一次 = 记尝试(揭示下一层提示(试(空进度, 0, 1), 0)[0], 0);
    expect(答案是否解锁(看过提示后再试一次, 0)).toBe(true);
    const 只试一次就看了提示 = 揭示下一层提示(试(空进度, 0, 1), 0)[0];
    expect(答案是否解锁(只试一次就看了提示, 0)).toBe(false);
  });

  it("已通过的题提示与答案全解锁", () => {
    const 通过 = 记通过(空进度, 5);
    expect(提示是否解锁(通过, 5)).toBe(true);
    expect(答案是否解锁(通过, 5)).toBe(true);
    expect(是否已通过(通过, 5)).toBe(true);
  });

  it("借助答案语义收紧：通过前查看记入，通过后查看不记", () => {
    const 未通过已解锁 = 试(空进度, 0, 3);
    const [看前, 记前] = 查看答案(未通过已解锁, 0);
    expect(记前).toBe(true);
    expect(是否借助答案(看前, 0)).toBe(true);

    const 已通过 = 记通过(空进度, 1);
    const [看后, 记后] = 查看答案(已通过, 1);
    expect(记后).toBe(false);
    expect(是否借助答案(看后, 1)).toBe(false);
  });

  it("解析进度：缺尝试次数字段回退为空记录（旧数据兼容）", () => {
    const 旧数据 = '{"已通过题号":[0],"已看提示":{"1":2},"已借助答案题号":[3]}';
    expect(解析进度(旧数据)).toEqual({
      已通过题号: [0],
      已看提示: { "1": 2 },
      已借助答案题号: [3],
      尝试次数: {},
    });
    const 新数据 = JSON.stringify(试(记通过(空进度, 2), 1, 4));
    expect(解析进度(新数据)).toEqual(解析进度(新数据));
    expect(解析进度(新数据).尝试次数["1"]).toBe(4);
  });
});
