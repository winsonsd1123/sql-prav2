import { describe, it, expect } from "vitest";
import { 校验语法, 映射运行时错误, 格式化 } from "../错误映射";

/** 循环一：MySQL 方言前置语法校验，语法错误产出 1064 三要素 */
describe("校验语法（1064 路径）", () => {
  it("合法 SELECT 不产出错误", () => {
    expect(校验语法("SELECT 姓名 FROM 学生 WHERE 性别 = '男'")).toBeNull();
  });

  it("关键字拼错产出 1064/42000 与 near token、行号", () => {
    const e = 校验语法("SELEC * FROM 学生");
    expect(e).not.toBeNull();
    expect(e!.错误码).toBe(1064);
    expect(e!.SQLSTATE).toBe("42000");
    // MySQL 语义：near 为从出错 token 起的剩余原文
    expect(e!.文案).toBe(
      "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'SELEC * FROM 学生' at line 1",
    );
  });

  it("文案格式化为 MySQL 客户端样式", () => {
    const e = 校验语法("SELECT * FORM 课程");
    expect(格式化(e!)).toMatch(/^ERROR 1064 \(42000\): You have an error in your SQL syntax;.*near '.*' at line 1$/);
  });
});

/** 循环二：SQLite errmsg 映射为 1146/1054/1305 三要素 */
describe("映射运行时错误", () => {
  it("no such table → 1146 (42S02)，文案含库名前缀", () => {
    const e = 映射运行时错误("no such table: 老师", "SELECT * FROM 老师");
    expect(格式化(e)).toBe("ERROR 1146 (42S02): Table 'playground.老师' doesn't exist");
  });

  it("no such column → 1054 (42S22)，字段列表场景为 field list", () => {
    const e = 映射运行时错误("no such column: 姓", "SELECT 姓 FROM 学生");
    expect(格式化(e)).toBe("ERROR 1054 (42S22): Unknown column '姓' in 'field list'");
  });

  it("no such column 在 WHERE 中 → where clause，且恢复表前缀写法", () => {
    const e = 映射运行时错误("no such column: 名字", "SELECT 学生.学号 FROM 学生 WHERE 学生.名字 = '张伟'");
    expect(格式化(e)).toBe("ERROR 1054 (42S22): Unknown column '学生.名字' in 'where clause'");
  });

  it("no such function → 1305 (42000)", () => {
    const e = 映射运行时错误("no such function: LEN", "SELECT LEN(姓名) FROM 学生");
    expect(格式化(e)).toBe("ERROR 1305 (42000): FUNCTION playground.LEN does not exist");
  });

  it("未识别模式尽力映射为 1105 (HY000)", () => {
    const e = 映射运行时错误("arbitrary sqlite failure", "SELECT 1");
    expect(格式化(e)).toBe("ERROR 1105 (HY000): arbitrary sqlite failure");
  });

  // 左侧边界（code-review #1）：一列名为另一列名的后缀时，不得把后缀出现当作该列出现
  it("后缀列不误判子句：WHERE 中只出现以该列为后缀的另一列 → field list", () => {
    const e = 映射运行时错误("no such column: name", "SELECT name FROM 用户 WHERE username = 'a'");
    expect(格式化(e)).toBe("ERROR 1054 (42S22): Unknown column 'name' in 'field list'");
  });

  it("前缀恢复不吃后缀列：语句同时含 name 与 username 时前缀与子句判定均正确", () => {
    const e = 映射运行时错误("no such column: name", "SELECT 用户.name FROM 用户 WHERE 用户.username = 'a'");
    expect(格式化(e)).toBe("ERROR 1054 (42S22): Unknown column '用户.name' in 'field list'");
  });

  it("中文后缀列同理：编号 与 选课编号 并存时不误匹配", () => {
    const e = 映射运行时错误("no such column: 编号", "SELECT 编号 FROM 课程 WHERE 选课编号 = 1");
    expect(格式化(e)).toBe("ERROR 1054 (42S22): Unknown column '编号' in 'field list'");
  });
});
