"use client";

// 域包详情页展示组件（票 #78 / spec #73 子票一）：只读结构化预览，分区折叠布局的骨架
// ——分区导航（库骨架 / 知识点清单 / 题目列表 / 难度档位与演练配置）+ 库骨架分区全量渲染；
// 其余三个分区由后续票（#80/#81）在骨架上补全。组件刻意与数据加载解耦（pack 由页面注入），
// 子票四「历史版本内容查看」复用本组件（spec #73 实现决策）。
// 严格只读：本组件不发起任何变更请求。

import Link from "next/link";
import type { ColumnDefinition, DomainPack, TableDefinition } from "@/kernel/types";

export interface AdminDomainPackDetailProps {
  /** URL 中的 packId（找不到时用于报错提示） */
  packId: string;
  /** 目标域包（展示清单中按 packId 精确命中）；null = 未命中或未就绪 */
  pack: DomainPack | null;
  /** 云端清单加载完成标记（false = 展示清单可能不全，暂按加载中呈现） */
  cloudLoaded: boolean;
}

/** 单列的骨架描述行：角色 / 名称池 / 类型 / 值池（或外键引用）/ 空值注入 */
function SkeletonColumnRow({ column }: { column: ColumnDefinition & { isPrimaryKey?: boolean } }) {
  return (
    <li className="border-t border-ink/5 py-1.5" data-testid={`骨架列-${column.columnRole}`}>
      <span className="font-medium">{column.columnRole}</span>
      {column.isPrimaryKey && <span className="ml-1 text-[10px] text-emerald-700">主键</span>}
      <span className="ml-2 text-xs text-muted">
        {column.columnNamePool && column.columnNamePool.length > 0
          ? `名称池：${column.columnNamePool.join("、")}`
          : `类型：${column.type}`}
        {column.columnNamePool && column.columnNamePool.length > 0 && ` · 类型：${column.type}`}
      </span>
      {/* 值池与外键引用互斥呈现：外键列值取自被引用表，无独立值池 */}
      {column.reference ? (
        <span className="ml-2 text-xs text-amber-700">引用 {column.reference.table}.{column.reference.column}</span>
      ) : (
        <span className="ml-2 text-xs text-muted">值池：{column.valuePool.join("、")}</span>
      )}
      {column.nullProbability !== undefined && (
        <span className="ml-2 text-xs text-muted">空值注入 {Math.round(column.nullProbability * 100)}%</span>
      )}
    </li>
  );
}

/** 单表的骨架卡片：语义角色 / 表名池 / 行数 / 列清单（主键列居首） */
function SkeletonTableCard({ table }: { table: TableDefinition }) {
  const primaryKeyColumn: (ColumnDefinition & { isPrimaryKey?: boolean }) | null = table.serialKey
    ? {
        columnRole: table.serialKey.columnRole,
        columnNamePool: table.serialKey.columnNamePool,
        type: "INTEGER",
        valuePool: [],
        isPrimaryKey: true,
      }
    : null;
  return (
    <section
      className="卡片 rounded-2xl border border-ink/10 bg-paper p-4"
      data-testid={`骨架表-${table.tableRole}`}
      aria-label={`骨架表 ${table.tableRole}`}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 className="标题 text-base">{table.tableRole}</h3>
        <span className="text-xs text-muted">语义角色：{table.tableRole}</span>
        {table.tableNamePool && <span className="text-xs text-muted">表名池：{table.tableNamePool.join("、")}</span>}
        <span className="text-xs text-muted">行数：{table.rowCount}</span>
        {table.serialKey && (
          <span className="text-xs text-muted">主键起始值：{table.serialKey.startValue}</span>
        )}
      </div>
      <ul className="text-sm">
        {primaryKeyColumn && <SkeletonColumnRow column={primaryKeyColumn} />}
        {table.columns.map((column) => (
          <SkeletonColumnRow key={column.columnRole} column={column} />
        ))}
      </ul>
    </section>
  );
}

export default function AdminDomainPackDetail({ packId, pack, cloudLoaded }: AdminDomainPackDetailProps) {
  if (!cloudLoaded) {
    return <p className="呼吸 text-sm text-muted" data-testid="域包详情加载中">正在加载域包清单……</p>;
  }
  if (pack === null) {
    return (
      <section className="卡片 rounded-2xl border border-ink/10 bg-paper p-5" data-testid="域包详情未找到">
        <h1 className="标题 mb-2 text-lg">未找到该域包</h1>
        <p className="text-sm text-muted">
          packId <span className="font-mono">{packId}</span> 不在展示清单中，可能已下线或地址有误。
        </p>
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-6" data-testid={`域包详情-${pack.name}`}>
      <div>
        <h1 className="标题 text-lg">域包详情：{pack.name}</h1>
        <p className="mt-1 font-mono text-xs text-muted">{pack.packId}</p>
      </div>
      {/* 分区导航（页面骨架）：四分区锚点常显，本票落地库骨架，其余为后续票占位 */}
      <nav
        className="横滑 flex items-center gap-1 overflow-x-auto rounded-full border border-ink/10 p-1 text-xs"
        data-testid="详情分区导航"
        aria-label="详情分区导航"
      >
        <Link href="#库骨架" className="whitespace-nowrap rounded-full px-3 py-1 hover:bg-panel">
          库骨架
        </Link>
        <Link href="#知识点清单" className="whitespace-nowrap rounded-full px-3 py-1 hover:bg-panel">
          知识点清单
        </Link>
        <Link href="#题目列表" className="whitespace-nowrap rounded-full px-3 py-1 hover:bg-panel">
          题目列表
        </Link>
        <Link
          href="#难度档位与演练配置"
          className="whitespace-nowrap rounded-full px-3 py-1 hover:bg-panel"
        >
          难度档位与演练配置
        </Link>
      </nav>
      <section id="库骨架" className="flex flex-col gap-4" data-testid="库骨架分区" aria-label="库骨架">
        <h2 className="标题 text-base">库骨架</h2>
        <p className="text-xs text-muted">
          该场景的数据模型全貌：每张表的语义角色、表名池、行数与列定义（值池 / 外键引用）。严格只读。
        </p>
        {pack.schemaSkeleton.map((table) => (
          <SkeletonTableCard key={table.tableRole} table={table} />
        ))}
      </section>
      {/* 后续票（#80/#81）补全的分区占位：锚点目标先落位，内容随票填充 */}
      <section id="知识点清单" data-testid="知识点清单分区" aria-label="知识点清单">
        <h2 className="标题 mb-1 text-base">知识点清单</h2>
        <p className="text-sm text-muted">分区建设中（后续功能补全）。</p>
      </section>
      <section id="题目列表" data-testid="题目列表分区" aria-label="题目列表">
        <h2 className="标题 mb-1 text-base">题目列表</h2>
        <p className="text-sm text-muted">分区建设中（后续功能补全）。</p>
      </section>
      <section id="难度档位与演练配置" data-testid="难度档位分区" aria-label="难度档位与演练配置">
        <h2 className="标题 mb-1 text-base">难度档位与演练配置</h2>
        <p className="text-sm text-muted">分区建设中（后续功能补全）。</p>
      </section>
    </div>
  );
}
