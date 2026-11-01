import { describe, expect, it } from "vitest";
import { buildColumnAnnotations } from "@/components/library-annotations";
import type { TableInstance } from "@/kernel/types";

const grades: TableInstance = {
  tableName: "成绩",
  columnNames: ["学号", "课程号", "分数"],
  types: ["INTEGER", "INTEGER", "INTEGER"],
  DDL: "",
  foreignKeys: [
    { column: "学号", referencesTable: "学生", referencesColumn: "学号" },
    { column: "课程号", referencesTable: "课程", referencesColumn: "课程号" },
  ],
  rows: [],
};

const withPk: TableInstance = {
  tableName: "学生",
  columnNames: ["学号", "姓名"],
  types: ["INTEGER", "TEXT"],
  DDL: "",
  primaryKeyColumn: "学号",
  rows: [],
};

describe("列清单结构语义标注（供库浏览器渲染徽章）", () => {
  it("主键列标注为主键徽章", () => {
    expect(buildColumnAnnotations(withPk)["学号"]).toEqual({ kind: "主键" });
  });

  it("外键列标注为 FK 指向（被引用表.列）", () => {
    expect(buildColumnAnnotations(grades)["学号"]).toEqual({ kind: "外键", target: "学生.学号" });
    expect(buildColumnAnnotations(grades)["课程号"]).toEqual({ kind: "外键", target: "课程.课程号" });
  });

  it("普通列无标注（undefined）", () => {
    expect(buildColumnAnnotations(grades)["分数"]).toBeUndefined();
    expect(buildColumnAnnotations(withPk)["姓名"]).toBeUndefined();
  });

  it("列同时是主键与外键时主键优先（外键指向仍可见于表级展示）", () => {
    const bothTable: TableInstance = {
      ...withPk,
      foreignKeys: [{ column: "学号", referencesTable: "院系", referencesColumn: "编号" }],
    };
    expect(buildColumnAnnotations(bothTable)["学号"]).toEqual({ kind: "主键" });
  });
});
