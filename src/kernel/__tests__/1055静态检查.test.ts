import { describe, it, expect } from "vitest";
import { validateGroupBy, type TableSummary } from "../error-mapping";

/**
 * 1055 静态检查（ONLY_FULL_GROUP_BY）单元测试：
 * 报错文案由夹具回归逐字断言（scripts 采样），此处聚焦"不误报"的保守边界——
 * 无法解析的结构一律放行（退化为 SQLite 运行时行为），绝不拦下 MySQL 会放行的查询。
 */
const 表 = (tableName: string, columnNames: string[]): TableSummary => ({ tableName, columnNames });
const 库 = [表("学生", ["学号", "姓名", "性别", "城市"]), 表("成绩", ["学号", "课程号", "分数"])];

describe("校验分组（1055 不误报边界）", () => {
  it("全部裸列在 GROUP BY 中不报", () => {
    expect(validateGroupBy("SELECT 学号, COUNT(*) FROM 成绩 GROUP BY 学号", 库)).toBeNull();
  });

  it("聚合函数包裹任意表达式不报", () => {
    expect(validateGroupBy("SELECT AVG(分数 + 1) FROM 成绩 GROUP BY 课程号", 库)).toBeNull();
  });

  it("分组列上的等价表达式不报（学号 + 1 对 GROUP BY 学号）", () => {
    expect(validateGroupBy("SELECT 学号 + 1, COUNT(*) FROM 成绩 GROUP BY 学号", 库)).toBeNull();
  });

  it("GROUP BY 别名（GROUP BY a 对 学号 AS a）不报", () => {
    expect(validateGroupBy("SELECT 学号 AS a, COUNT(*) FROM 成绩 GROUP BY a", 库)).toBeNull();
  });

  it("隐式别名不报", () => {
    expect(validateGroupBy("SELECT 学号 n, COUNT(*) FROM 成绩 GROUP BY 学号", 库)).toBeNull();
  });

  it("ORDER BY 聚合或分组列或 SELECT 别名不报", () => {
    expect(validateGroupBy("SELECT 学号, COUNT(*) AS c FROM 成绩 GROUP BY 学号 ORDER BY c", 库)).toBeNull();
    expect(validateGroupBy("SELECT 学号, COUNT(*) FROM 成绩 GROUP BY 学号 ORDER BY COUNT(*)", 库)).toBeNull();
  });

  it("无 GROUP BY 的查询不检查", () => {
    expect(validateGroupBy("SELECT 学号 FROM 成绩", 库)).toBeNull();
  });

  it("未知列优先放行（MySQL 名字解析先于 1055，运行时映射 1054）", () => {
    expect(validateGroupBy("SELECT 姓, 学号 FROM 学生 GROUP BY 姓名", 库)).toBeNull();
  });

  it("未知表放行（运行时映射 1146）", () => {
    expect(validateGroupBy("SELECT a.x, COUNT(*) FROM 老师 a GROUP BY a.x", 库)).toBeNull();
  });

  it("FROM 子查询等解析不了的结构保守放行", () => {
    expect(validateGroupBy("SELECT t.x, COUNT(*) FROM (SELECT 学号 AS x FROM 成绩) t GROUP BY t.x", 库)).toBeNull();
  });
});

describe("校验分组（1055 报错路径）", () => {
  it("SELECT 裸列不在 GROUP BY 中报 1055，序号为列表位置", () => {
    const e = validateGroupBy("SELECT COUNT(*), 城市 FROM 学生 GROUP BY 姓名", 库)!;
    expect(e.errorCode).toBe(1055);
    expect(e.SQLSTATE).toBe("42000");
    expect(e.message).toContain("Expression #2 of SELECT list");
    expect(e.message).toContain("'playground.学生.城市'");
  });

  it("别名前缀在文案中按原书写保留", () => {
    const e = validateGroupBy("SELECT s.姓名, COUNT(*) FROM 学生 s GROUP BY s.学号", 库)!;
    expect(e.message).toContain("'playground.s.姓名'");
  });

  it("ORDER BY 非分组裸列报 ORDER BY clause 文案", () => {
    const e = validateGroupBy("SELECT 学号 FROM 成绩 GROUP BY 学号 ORDER BY 分数", 库)!;
    expect(e.message).toContain("Expression #1 of ORDER BY clause");
  });

  it("同一列表项中未知列在先时放行（1054 优先）", () => {
    expect(validateGroupBy("SELECT CONCAT(姓, 姓名) FROM 学生 GROUP BY 学号", 库)).toBeNull();
  });
});
