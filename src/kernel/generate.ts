import type { DomainPack, Session, TableInstance, TableDefinition, QuestionInstance, QuestionTemplate } from "./types";
import { createRandomSource, type RandomSource } from "./prng";
import { assertDataIntegrity } from "./integrity";

/**
 * 表按引用依赖拓扑排序：被引用表排在引用表之前。
 * 稳定排序（同层保持定义序），保证同种子下 schema 表顺序拓扑等价重排产出一致。
 * 依赖成环或引用不存在的表时显式抛错。
 */
export function topologicalTableOrder(schema: TableDefinition[]): TableDefinition[] {
  const byRole = new Map(schema.map((t) => [t.tableRole, t]));
  // 依赖边：本表 → 被引用表（被引用表入度来源）
  const dependencies = new Map<string, Set<string>>();
  for (const table of schema) {
    dependencies.set(table.tableRole, new Set());
    for (const column of table.columns) {
      if (!column.reference) continue;
      if (!byRole.has(column.reference.table)) {
        throw new Error(`引用了未定义的表：${column.reference.table}`);
      }
      dependencies.get(table.tableRole)!.add(column.reference.table);
    }
  }
  const ordered: TableDefinition[] = [];
  const done = new Set<string>();
  // 反复扫定义序，已满足依赖（被引用表全部完成）的表按序落位；一轮无进展即成环
  while (ordered.length < schema.length) {
    const before = ordered.length;
    for (const table of schema) {
      if (done.has(table.tableRole)) continue;
      if ([...dependencies.get(table.tableRole)!].every((dep) => done.has(dep))) {
        ordered.push(table);
        done.add(table.tableRole);
      }
    }
    if (ordered.length === before) {
      const stuck = schema.filter((t) => !done.has(t.tableRole)).map((t) => t.tableRole);
      throw new Error(`引用依赖成环，无法拓扑排序：${stuck.join("、")}`);
    }
  }
  return ordered;
}

/**
 * 生成（判题内核接缝之一）：种子 + 域包 → 会话。
 * 纯函数：不触碰 IO、Date、Math.random；同种子字节级复现。
 * 四层随机化（表名/列名、题目参数、数据、刻意注入）全部由同一随机源按种子驱动。
 */
export function generateSession(seed: number, pack: DomainPack): Session {
  const random = createRandomSource(seed);
  // 表生成顺序按引用依赖拓扑排序（票 #54）：被引用表必先于引用表生成，
  // 取代对 schemaSkeleton 手工排列顺序的依赖；同层多候选时保持定义序（确定性）。
  const orderedSchema = topologicalTableOrder(pack.schemaSkeleton);
  // 第一层：表名/列名实例化——每语义角色从候选池按种子选定实际名。
  const nameMap = new Map<string, { actualTableName: string; columnMap: Map<string, string> }>();
  for (const table of orderedSchema) {
    const columnMap = new Map<string, string>();
    const used = new Set<string>();
    const pickName = (candidates: string[] | undefined, role: string): string => {
      const pool = candidates && candidates.length > 0 ? candidates : [role];
      let name = random.pick(pool);
      // 同表内实际名不允许碰撞（候选池有交叠时顺延取下一个未用名）
      let i = pool.indexOf(name);
      while (used.has(name) && i < pool.length - 1) name = pool[++i];
      if (used.has(name)) throw new Error(`列名候选池不足以避免碰撞：${table.tableRole}.${role}`);
      used.add(name);
      return name;
    };
    if (table.serialKey) columnMap.set(table.serialKey.columnRole, pickName(table.serialKey.columnNamePool, table.serialKey.columnRole));
    for (const c of table.columns) columnMap.set(c.columnRole, pickName(c.columnNamePool, c.columnRole));
    nameMap.set(table.tableRole, { actualTableName: pickName(table.tableNamePool, table.tableRole), columnMap });
  }

  // 数据生成（第三、四层随机）：引用列按被引用表的实际值取值。
  const generatedTables = new Map<string, TableInstance>();
  for (const table of orderedSchema) {
    generatedTables.set(table.tableRole, generateTable(table, random, generatedTables, nameMap));
  }
  // 生成期自检（票 #54）：数据必须满足三断言，违规即抛错而非静默产出
  assertDataIntegrity([...generatedTables.values()]);

  return {
    seed,
    packId: pack.packId,
    database: { tables: pack.schemaSkeleton.map((t) => generatedTables.get(t.tableRole)!) },
    questions: pack.templates.map((template) => instantiateTemplate(template, generatedTables, random, nameMap)),
  };
}

function generateTable(
  table: TableDefinition,
  random: RandomSource,
  generatedTables: Map<string, TableInstance>,
  nameMap: Map<string, { actualTableName: string; columnMap: Map<string, string> }>,
): TableInstance {
  const tableNaming = nameMap.get(table.tableRole)!;
  // 引用池以语义角色为键，值取自被引用表（被引用表先于本表生成）
  const referencePool = new Map<string, (string | number | null)[]>();
  for (const column of table.columns) {
    if (column.reference) {
      const referencedTable = generatedTables.get(column.reference.table);
      if (!referencedTable) throw new Error(`引用了未生成的表：${column.reference.table}`);
      const actualColumnName = nameMap.get(column.reference.table)!.columnMap.get(column.reference.column);
      if (!actualColumnName) throw new Error(`未知引用列：${column.reference.table}.${column.reference.column}`);
      const idx = referencedTable.columnNames.indexOf(actualColumnName);
      // 引用池剔除 NULL（被引用列可空时仍保证外键值指向真实存在的行）
      const pool = referencedTable.rows.map((r) => r[idx]).filter((v) => v !== null);
      if (pool.length === 0) {
        throw new Error(
          `引用候选池为空：${table.tableRole}.${column.columnRole} 引用 ${column.reference.table}.${column.reference.column}（被引用表无可用非空行）`,
        );
      }
      referencePool.set(column.columnRole, pool);
    }
  }

  const rows: (string | number | null)[][] = [];
  for (let i = 0; i < table.rowCount; i++) {
    const rowValues: (string | number | null)[] = [];
    if (table.serialKey) rowValues.push(table.serialKey.startValue + i);
    for (const column of table.columns) {
      if (table.serialKey && column.columnRole === table.serialKey.columnRole) continue;
      if (referencePool.has(column.columnRole)) {
        rowValues.push(random.pick(referencePool.get(column.columnRole)!));
      } else if (column.nullProbability !== undefined && random.chance(column.nullProbability)) {
        rowValues.push(null); // 第四层：刻意注入 NULL
      } else {
        rowValues.push(random.pick(column.valuePool));
      }
    }
    rows.push(rowValues);
  }

  // 列定义顺序统一为：序列主键在前，其余按定义序；DDL 用实际名。
  const roleOrder = table.serialKey ? [table.serialKey.columnRole, ...table.columns.map((c) => c.columnRole)] : table.columns.map((c) => c.columnRole);
  const columnNames = roleOrder.map((role) => tableNaming.columnMap.get(role)!);
  const types = table.serialKey ? ["INTEGER", ...table.columns.map((c) => c.type)] : table.columns.map((c) => c.type);

  // 结构语义（票 #54）：主键列、外键指向、非空列清单，均以实例化后的实际名表达，
  // 供 DDL 子句、完整性断言（integrity.ts）与库浏览器徽章共用。
  const primaryKeyColumn = table.serialKey ? tableNaming.columnMap.get(table.serialKey.columnRole) : undefined;
  const foreignKeys = table.columns
    .filter((c) => c.reference)
    .map((c) => ({
      column: tableNaming.columnMap.get(c.columnRole)!,
      referencesTable: nameMap.get(c.reference!.table)!.actualTableName,
      referencesColumn: nameMap.get(c.reference!.table)!.columnMap.get(c.reference!.column)!,
    }));
  // 非空声明：主键、引用列必非空（取值规则保证）；普通列声明了 nullProbability 即可空
  const notNullRoles = [
    ...(table.serialKey ? [table.serialKey.columnRole] : []),
    ...table.columns.filter((c) => c.reference || c.nullProbability === undefined).map((c) => c.columnRole),
  ];
  const notNullColumns = notNullRoles.map((role) => tableNaming.columnMap.get(role)!);
  const foreignKeyClauses = foreignKeys.map(
    (fk) => `FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencesTable}(${fk.referencesColumn})`,
  );
  // DDL 自带完整性语义：主键/非空列内联声明，外键用表级子句（SQLite 外键默认不强制，仅表达结构语义）
  const DDL = `CREATE TABLE ${tableNaming.actualTableName} (${[
    ...columnNames.map((n, i) => {
      if (primaryKeyColumn === n) return `${n} ${types[i]} PRIMARY KEY`;
      return `${n} ${types[i]}${notNullColumns.includes(n) ? " NOT NULL" : ""}`;
    }),
    ...foreignKeyClauses,
  ].join(", ")});`;

  return {
    tableName: tableNaming.actualTableName,
    columnNames,
    types,
    DDL,
    rows,
    ...(primaryKeyColumn !== undefined ? { primaryKeyColumn } : {}),
    ...(foreignKeys.length > 0 ? { foreignKeys } : {}),
    notNullColumns,
  };
}

/** 实例化模板：解析语义角色占位符与参数占位符，产出可作答的题目实例 */
function instantiateTemplate(
  template: QuestionTemplate,
  generatedTables: Map<string, TableInstance>,
  random: RandomSource,
  nameMap: Map<string, { actualTableName: string; columnMap: Map<string, string> }>,
): QuestionInstance {
  // 第二层：题目参数随机（含关联参数对象，如排序方向的描述与 SQL 关键字成对取用）
  const args: Record<string, unknown> = {};
  for (const [name, candidates] of Object.entries(template.paramPool ?? {})) {
    args[name] = random.pick(candidates);
  }
  const substitute = (text: string) =>
    text
      .replace(/\{\{table\.([^}]+)\}\}/g, (_, table: string) => {
        const n = nameMap.get(table);
        if (!n) throw new Error(`未知语义角色表：${table}`);
        return n.actualTableName;
      })
      .replace(/\{\{col\.([^}.]+)\.([^}]+)\}\}/g, (_, table: string, role: string) => {
        const n = nameMap.get(table);
        if (!n) throw new Error(`未知语义角色表：${table}`);
        const actualColumnName = n.columnMap.get(role);
        if (actualColumnName === undefined || !generatedTables.get(table)!.columnNames.includes(actualColumnName)) {
          throw new Error(`未知语义角色列：${table}.${role}`);
        }
        return actualColumnName;
      })
      .replace(/\{\{param\.([^}]+)\}\}/g, (_, namePath: string) => {
        // 支持 {{param.X}}（标量）与 {{param.X.子键}}（关联参数对象）
        const [name, ...childKeys] = namePath.split(".");
        if (!(name in args)) throw new Error(`未提供参数：${name}`);
        let value: unknown = args[name];
        for (const key of childKeys) {
          if (value === null || typeof value !== "object") {
            throw new Error(`参数 ${name} 不是关联参数，不支持子键 ${key}`);
          }
          value = (value as Record<string, unknown>)[key];
          if (value === undefined) throw new Error(`参数 ${name} 缺少子键 ${key}`);
        }
        return String(value);
      });

  return {
    templateId: template.templateId,
    knowledgeArea: template.knowledgeArea,
    difficulty: template.difficulty,
    prompt: substitute(template.prompt),
    hints: template.hints.map(substitute) as [string, string],
    referenceAnswer: substitute(template.referenceAnswer),
    ordered: template.ordered,
    ...(template.commonMistake !== undefined ? { commonMistake: substitute(template.commonMistake) } : {}),
    ...(template.semanticTrap !== undefined ? { semanticTrap: template.semanticTrap.map(substitute) } : {}),
  };
}
