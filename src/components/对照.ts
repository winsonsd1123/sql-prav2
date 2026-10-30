// "你的结果 / 预期结果"差异对照的纯数据构造（issue #9）。
// 判题等价规则：列名/列序不敏感、行序仅在 ordered 时敏感；对照视图按同一规则对齐，
// 使差异行/列可定位：ordered 按位置比对到单元格；非 ordered 按多重集合找出多出/缺失的行。

import type { ResultSet, DisplayValue } from "@/kernel/types";

export interface 对照单元格 {
  值: DisplayValue;
  /** 该单元格与对侧同位值不等 */
  差异: boolean;
}

export interface 对照侧视图 {
  列名: string[];
  /** 列差异：该列在对侧没有对应列（按列名匹配） */
  列差异: boolean[];
  行: 对照单元格[][];
  /** 行差异：该行是对侧缺失（或含差异单元格）的行 */
  行差异: boolean[];
}

export interface 对照视图 {
  左: 对照侧视图; // 你的结果
  右: 对照侧视图; // 预期结果
  /** 任一侧行数超过展示上限、被截断时的说明，未截断为 null */
  截断说明: string | null;
}

const 行键 = (行: DisplayValue[]): string => JSON.stringify(行);

/**
 * 构造并排对照视图。前N行 = 展示的行数上限；差异判定在完整结果集上计算后再截断，
 * 保证截断不影响差异定位的正确性。
 */
export function 构造对照(学生: ResultSet, 预期: ResultSet, ordered: boolean, 前N行 = 10): 对照视图 {
  // 1) 列对齐：按列名把学生列映射到预期列（列名不敏感）；未匹配的列留在末尾并标差异。
  const 预期列位置 = new Map(预期.columns.map((名, j) => [名, j]));
  const 学生到预期 = new Array(学生.columns.length).fill(-1);
  const 已占用 = new Array(预期.columns.length).fill(false);
  学生.columns.forEach((名, i) => {
    const j = 预期列位置.get(名);
    if (j !== undefined && !已占用[j]) {
      学生到预期[i] = j;
      已占用[j] = true;
    }
  });
  // 重排后的学生侧：预期列顺序在前，未匹配的学生列殿后
  const 重排 = 学生到预期.map((j, i) => ({ j, i })).filter((x) => x.j >= 0).sort((a, b) => a.j - b.j);
  const 殿后 = 学生到预期.map((j, i) => ({ j, i })).filter((x) => x.j < 0);
  const 学生列序 = [...重排, ...殿后].map((x) => x.i);

  const 左列名 = 学生列序.map((i) => 学生.columns[i]);
  const 左行 = 学生.rows.map((行) => 学生列序.map((i) => 行[i]));
  const 右列名 = 预期.columns;
  const 右行 = 预期.rows;

  const 右列差异 = 已占用.map((占用) => !占用);
  const 左列差异 = 学生列序.map((_, 位置) => 位置 >= 重排.length);

  const 左差异行: boolean[] = [];
  const 右差异行: boolean[] = [];
  const 左标记: (boolean[] | null)[] = []; // 每行的单元格差异（有序比对时才有）
  const 右标记: (boolean[] | null)[] = [];

  if (ordered) {
    const 行数 = Math.max(左行.length, 右行.length);
    for (let i = 0; i < 行数; i++) {
      const a = 左行[i];
      const b = 右行[i];
      if (a === undefined || b === undefined) {
        左差异行.push(a !== undefined);
        右差异行.push(b !== undefined);
        左标记.push(a !== undefined ? null : []);
        右标记.push(b !== undefined ? null : []);
        continue;
      }
      const 宽 = Math.max(a.length, b.length);
      const 单元差异 = Array.from({ length: 宽 }, (_, j) => !值相等(a[j] ?? null, b[j] ?? null));
      const 行不等 = 单元差异.some(Boolean);
      左差异行.push(行不等);
      右差异行.push(行不等);
      左标记.push(行不等 ? 单元差异.slice(0, a.length) : null);
      右标记.push(行不等 ? 单元差异.slice(0, b.length) : null);
    }
  } else {
    // 行序不敏感：按多重集合计数，找出学生侧多出的行与预期侧缺失的行
    const 原计数 = new Map<string, number>();
    for (const 行 of 右行) 原计数.set(行键(行), (原计数.get(行键(行)) ?? 0) + 1);
    const 剩余 = new Map(原计数);
    for (const 行 of 左行) {
      const 键 = 行键(行);
      const 余量 = 剩余.get(键) ?? 0;
      if (余量 > 0) 剩余.set(键, 余量 - 1);
      左差异行.push(余量 > 0 ? false : true);
      左标记.push(null);
    }
    // 预期侧：每个键前 matched 个实例视为已匹配，其余为缺失行
    const matched = new Map([...原计数].map(([键, 总]) => [键, 总 - (剩余.get(键) ?? 0)]));
    const 出现序 = new Map<string, number>();
    for (const 行 of 右行) {
      const 键 = 行键(行);
      const 序 = (出现序.get(键) ?? 0) + 1;
      出现序.set(键, 序);
      右差异行.push(序 <= (matched.get(键) ?? 0) ? false : true);
      右标记.push(null);
    }
  }

  // ordered 比对按 max(行数) 推入标记，裁齐到各自行数（多余行为截断展示外的占位）
  左差异行.length = 左行.length;
  右差异行.length = 右行.length;
  左标记.length = 左行.length;
  右标记.length = 右行.length;

  const 截断 = 左行.length > 前N行 || 右行.length > 前N行;
  const 截取 = (行: DisplayValue[][], 标记: (boolean[] | null)[]) =>
    行.slice(0, 前N行).map((r, i) => {
      const 单元 = 标记[i];
      return r.map((值, j) => ({ 值, 差异: 单元 !== null && 单元[j] === true }));
    });

  return {
    左: {
      列名: 左列名,
      列差异: 左列差异,
      行差异: 左差异行.slice(0, 前N行),
      行: 截取(左行, 左标记),
    },
    右: {
      列名: 右列名,
      列差异: 右列差异,
      行差异: 右差异行.slice(0, 前N行),
      行: 截取(右行, 右标记),
    },
    截断说明: 截断
      ? `结果超过 ${前N行} 行，仅对照前 ${前N行} 行（差异统计基于完整结果集）`
      : null,
  };
}

/** 与判题一致的显示值相等：NULL/空串/类型严格区分 */
function 值相等(a: DisplayValue, b: DisplayValue): boolean {
  return a === b;
}
