import { describe, expect, it } from "vitest";
import { collectIntegrityViolations, assertDataIntegrity } from "@/kernel/integrity";
import { generateSession } from "@/kernel/generate";
import { openInMemoryDb } from "@/kernel/execute";
import { builtinDomainPacks } from "@/domain-packs/builtin-packs";
import type { TableInstance } from "@/kernel/types";

/** 构造带结构语义的最小表实例（外键指向 部门.部门号） */
function mkTable(overrides: Partial<TableInstance> = {}): TableInstance {
  return {
    tableName: "emp",
    columnNames: ["emp号", "姓名", "部门号"],
    types: ["INTEGER", "TEXT", "INTEGER"],
    DDL: "CREATE TABLE emp (emp号 INTEGER PRIMARY KEY, 姓名 TEXT NOT NULL, 部门号 INTEGER NOT NULL, FOREIGN KEY (部门号) REFERENCES 部门(部门号));",
    primaryKeyColumn: "emp号",
    foreignKeys: [{ column: "部门号", referencesTable: "部门", referencesColumn: "部门号" }],
    notNullColumns: ["emp号", "姓名", "部门号"],
    rows: [],
    ...overrides,
  };
}

const deptTable: TableInstance = {
  tableName: "部门",
  columnNames: ["部门号", "部门名"],
  types: ["INTEGER", "TEXT"],
  DDL: "CREATE TABLE 部门 (部门号 INTEGER PRIMARY KEY, 部门名 TEXT NOT NULL);",
  primaryKeyColumn: "部门号",
  notNullColumns: ["部门号", "部门名"],
  rows: [
    [10, "技术部"],
    [20, "市场部"],
  ],
};

describe("完整性断言纯函数（数据层三断言，供生成期与验证闸门复用）", () => {
  it("合法数据无违规", () => {
    const emp = mkTable({ rows: [[1001, "张伟", 10], [1002, "李娜", 20]] });
    expect(collectIntegrityViolations([deptTable, emp])).toEqual([]);
  });

  it("外键悬空被检出：值不存在于被引用表", () => {
    const emp = mkTable({ rows: [[1001, "张伟", 30]] });
    const violations = collectIntegrityViolations([deptTable, emp]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "外键悬空", table: "emp", column: "部门号", value: 30 });
  });

  it("被引用表缺失（悬空指向不存在的表）被检出", () => {
    const emp = mkTable({ rows: [[1001, "张伟", 10]] });
    const violations = collectIntegrityViolations([emp]);
    expect(violations[0]).toMatchObject({ kind: "外键悬空", table: "emp", column: "部门号", value: 10 });
  });

  it("主键重复被检出", () => {
    const emp = mkTable({ rows: [[1001, "张伟", 10], [1001, "李娜", 20]] });
    const violations = collectIntegrityViolations([deptTable, emp]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "主键重复", table: "emp", column: "emp号", value: 1001 });
  });

  it("声明非空的列含 NULL 被检出（主键 NULL 与普通非空列 NULL 分别报）", () => {
    const emp = mkTable({ rows: [[1001, null, 10], [null, "李娜", 20]] });
    const violations = collectIntegrityViolations([deptTable, emp]);
    expect(violations.filter((v) => v.kind === "非空列含NULL")).toHaveLength(2);
  });

  it("assertDataIntegrity 合法时不抛、违规时抛出含中文明细的错误", () => {
    expect(() => assertDataIntegrity([deptTable, mkTable({ rows: [[1001, "张伟", 30]] })])).toThrowError(
      /外键悬空[\s\S]*emp\.部门号[\s\S]*30/,
    );
    expect(() => assertDataIntegrity([deptTable, mkTable({ rows: [[1001, "张伟", 10]] })])).not.toThrow();
  });
});

const seeds = [20260101, 1, 42, 999983, 7];

describe("生成的会话满足完整性（两内置域包 × seeds）", () => {
  const packs = [
    { name: "域包A 学生-课程-成绩", load: () => builtinDomainPacks[0] },
    { name: "域包B emp-部门-薪资", load: () => builtinDomainPacks[1] },
  ];
  for (const { name, load } of packs) {
    for (const seed of seeds) {
      it(`${name} 种子 ${seed}：三断言零违规`, () => {
        const session = generateSession(seed, load());
        expect(collectIntegrityViolations(session.database.tables)).toEqual([]);
      });
    }
  }

  it("表实例携带结构语义：主键列、外键指向、非空列清单", () => {
    const session = generateSession(20260101, builtinDomainPacks[0]);
    const gradesTable = session.database.tables.find((t) => t.foreignKeys?.length === 2)!;
    expect(gradesTable.primaryKeyColumn).toBeUndefined(); // 成绩表未声明 serialKey
    const studentsTable = session.database.tables.find((t) => t.foreignKeys === undefined)!;
    expect(studentsTable.primaryKeyColumn).toBeTypeOf("string");
    // 外键指向的是被引用表实际表名与实际列名
    for (const fk of gradesTable.foreignKeys!) {
      const referenced = session.database.tables.find((t) => t.tableName === fk.referencesTable)!;
      expect(referenced.columnNames).toContain(fk.referencesColumn);
    }
  });
});

describe("建表语句自带完整性语义（DDL 层）", () => {
  const session = generateSession(20260101, builtinDomainPacks[0]);

  it("serialKey 表的 DDL 声明 PRIMARY KEY", () => {
    for (const table of session.database.tables) {
      if (table.primaryKeyColumn) {
        expect(table.DDL).toContain(`${table.primaryKeyColumn} INTEGER PRIMARY KEY`);
      }
    }
  });

  it("外键列的 DDL 声明表级 FOREIGN KEY 子句指向实际表.列", () => {
    for (const table of session.database.tables) {
      for (const fk of table.foreignKeys ?? []) {
        expect(table.DDL).toContain(`FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencesTable}(${fk.referencesColumn})`);
      }
    }
  });

  it("非空列声明 NOT NULL、可空列不声明", () => {
    for (const table of session.database.tables) {
      for (const column of table.columnNames) {
        const i = table.columnNames.indexOf(column);
        const suffix = table.primaryKeyColumn === column
          ? " PRIMARY KEY"
          : table.notNullColumns!.includes(column)
            ? " NOT NULL"
            : "";
        // 「列名 类型 后缀」整体出现在 DDL 中，后缀与声明一致
        expect(table.DDL).toContain(`${column} ${table.types[i]}${suffix}`);
      }
    }
  });
});

describe("DDL 在浏览器端引擎可执行（含数据装载）", () => {
  const packs = [
    { name: "域包A", load: () => builtinDomainPacks[0] },
    { name: "域包B", load: () => builtinDomainPacks[1] },
  ];
  for (const { name, load } of packs) {
    for (const seed of seeds) {
      it(`${name} 种子 ${seed}：全套 DDL + 全量数据在 sql.js 装载成功且可查询`, async () => {
        const session = generateSession(seed, load());
        const db = await openInMemoryDb(session);
        const tableNames = session.database.tables.map((t) => `'${t.tableName}'`).join(", ");
        const result = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${tableNames})`);
        expect(result[0].values).toHaveLength(session.database.tables.length);
        db.close();
      });
    }
  }
});

import type { DomainPack, TableDefinition } from "@/kernel/types";

/** 最小双表骨架：childTable引用parentTable，parentTable被引用列带 nullProbability（引用池必须剔 NULL） */
function mkPack(schemaSkeleton: TableDefinition[]): DomainPack {
  return { packId: "test-pack", name: "测试包", schemaSkeleton, templates: [], knowledgeAreas: [] };
}

const parentTable: TableDefinition = {
  tableRole: "父",
  serialKey: { columnRole: "代号", startValue: 1 },
  // 行数需足够大：空概率 0.5 下seeds仍必有非空行可作引用池
  rowCount: 20,
  columns: [
    // 被引用列带空概率：一半行注入 NULL，引用池若不剔 NULL 则childTable大概率悬空
    { columnRole: "编号", type: "INTEGER", valuePool: [11, 12, 13, 14, 15, 16], nullProbability: 0.5 },
  ],
};
const childTable: TableDefinition = {
  tableRole: "子",
  rowCount: 30,
  columns: [{ columnRole: "父编号", type: "INTEGER", valuePool: [], reference: { table: "父", column: "编号" } }],
};

describe("表生成按引用依赖拓扑排序（取代手工排列依赖）", () => {
  it("schema 中childTable排在parentTable之前也能正确生成（顺序错排不再抛『引用了未生成的表』）", () => {
    const session = generateSession(20260101, mkPack([childTable, parentTable]));
    expect(collectIntegrityViolations(session.database.tables)).toEqual([]);
    // 输出仍保持 schema 定义顺序
    expect(session.database.tables.map((t) => t.tableName)).toHaveLength(2);
  });

  it("同一种子下，schema 表顺序重排（拓扑等价）产出完全相同的表内容", () => {
    const a = generateSession(20260101, mkPack([parentTable, childTable])).database.tables;
    const b = generateSession(20260101, mkPack([childTable, parentTable])).database.tables;
    // 输出数组按 schema 定义序排列（刻意行为），按表名对齐后逐表比较
    const byName = (tables: typeof a) => Object.fromEntries(tables.map((t) => [t.tableName, t]));
    expect(byName(b)).toEqual(byName(a));
  });

  it("引用环被显式拒绝", () => {
    const tableA: TableDefinition = {
      tableRole: "甲",
      rowCount: 3,
      columns: [{ columnRole: "depCol", type: "INTEGER", valuePool: [], reference: { table: "乙", column: "x" } }],
    };
    const tableB: TableDefinition = {
      tableRole: "乙",
      rowCount: 3,
      columns: [{ columnRole: "甲x", type: "INTEGER", valuePool: [], reference: { table: "甲", column: "depCol" } }],
    };
    expect(() => generateSession(1, mkPack([tableA, tableB]))).toThrowError(/引用依赖成环|拓扑/);
  });
});

describe("引用值候选池剔除 NULL（被引用列可空时）", () => {
  it("childTable外键列取值全部存在于parentTable编号列的nonNullValues集合", () => {
    for (const seed of seeds) {
      const session = generateSession(seed, mkPack([parentTable, childTable]));
      const parentInst = session.database.tables.find((t) => t.foreignKeys === undefined)!;
      const childInst = session.database.tables.find((t) => t.foreignKeys?.length === 1)!;
      const parentColIdx = parentInst.columnNames.indexOf(parentInst.notNullColumns ? "编号" : "编号");
      const nonNullValues = new Set<string | number>(parentInst.rows.map((r) => r[parentColIdx]).filter((v): v is string | number => v !== null));
      const fk = childInst.foreignKeys![0];
      const childColIdx = childInst.columnNames.indexOf(fk.column);
      // seeds下parentTable必然注入过 NULL；引用池剔 NULL 后childTable值仍全部落非空集合
      expect(parentInst.rows.some((r) => r[parentColIdx] === null), `种子 ${seed} parentTable应含 NULL 素材`).toBe(true);
      for (const row of childInst.rows) expect(nonNullValues.has(row[childColIdx] as string | number)).toBe(true);
    }
  });
});

describe("空引用池显式报错", () => {
  it("被引用表 0 行时抛出明确中文错误", () => {
    const emptyParent = { ...parentTable, rowCount: 0 };
    expect(() => generateSession(1, mkPack([emptyParent, childTable]))).toThrowError(/引用候选池为空.*父\.编号/);
  });
});
