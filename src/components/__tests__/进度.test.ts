import { describe, expect, it } from "vitest";
import {
  空进度,
  进度键,
  解析进度,
  记通过,
  揭示下一层提示,
  借助答案,
  完成度,
  是否借助答案,
  记草稿,
  取草稿,
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

  it("记草稿：按题号保存与覆盖，相同内容原样返回（幂等）", () => {
    const p1 = 记草稿(空进度, 0, "SELECT 1");
    expect(取草稿(p1, 0)).toBe("SELECT 1");
    expect(取草稿(p1, 1)).toBe(""); // 其他题无草稿，回退空串
    const p2 = 记草稿(p1, 0, "SELECT 2");
    expect(取草稿(p2, 0)).toBe("SELECT 2"); // 覆盖
    const p3 = 记草稿(p2, 0, "SELECT 2");
    expect(p3).toBe(p2); // 内容未变则原样返回
    expect(取草稿(p1, 0)).toBe("SELECT 1"); // 原 state 未被修改
  });

  it("记草稿：空串清除该题草稿（不留空串残迹）", () => {
    const p1 = 记草稿(空进度, 3, "SELECT 1");
    const p2 = 记草稿(p1, 3, "");
    expect(取草稿(p2, 3)).toBe("");
    expect(p2.草稿["3"]).toBeUndefined();
  });

  it("草稿按题号隔离：互不干扰", () => {
    const p = 记草稿(记草稿(空进度, 1, "SELECT a"), 2, "SELECT b");
    expect(取草稿(p, 1)).toBe("SELECT a");
    expect(取草稿(p, 2)).toBe("SELECT b");
  });

  it("进度键随域包与种子区分（换一套/换域包即换键）", () => {
    expect(进度键("packA", 1)).not.toBe(进度键("packA", 2));
    expect(进度键("packA", 1)).not.toBe(进度键("packB", 1));
  });

  it("解析进度：合法 JSON 还原（含草稿）；非法回退空进度", () => {
    const 原 = 记草稿(借助答案(记通过(揭示下一层提示(空进度, 1)[0], 0), 1), 2, "SELECT c");
    expect(解析进度(JSON.stringify(原))).toEqual(原);
    expect(解析进度(null)).toEqual(空进度);
    expect(解析进度("不是JSON")).toEqual(空进度);
    expect(解析进度('{"已通过题号":[1,-2]}')).toEqual(空进度);
    expect(解析进度('{"已通过题号":[0],"已看提示":{"x":1,"1":9},"已借助答案题号":[3]}')).toEqual({
      已通过题号: [0],
      已看提示: {},
      已借助答案题号: [3],
      草稿: {},
    });
  });

  it("解析进度：旧数据缺草稿字段回退为空草稿（向后兼容）", () => {
    const 旧数据 = '{"已通过题号":[0],"已看提示":{"0":1},"已借助答案题号":[]}';
    const p = 解析进度(旧数据);
    expect(p).toEqual({ 已通过题号: [0], 已看提示: { "0": 1 }, 已借助答案题号: [], 草稿: {} });
    expect(取草稿(p, 0)).toBe("");
  });

  it("解析进度：草稿字段只收留数字题号→字符串的条目", () => {
    const p = 解析进度(
      '{"已通过题号":[],"已看提示":{},"已借助答案题号":[],"草稿":{"1":"SELECT 1","x":"SELECT x","2":3,"3":"SELECT 3"}}',
    );
    expect(p.草稿).toEqual({ "1": "SELECT 1", "3": "SELECT 3" });
  });
});
