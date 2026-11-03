"use client";

// 域包详情页展示组件（票 #78 / spec #73 子票一）：只读结构化预览，分区折叠布局的骨架
// ——分区导航（库骨架 / 知识点清单 / 题目列表 / 难度档位与演练配置）+ 全分区渲染。
// 组件刻意与数据加载解耦（pack 由页面注入），子票四「历史版本内容查看」复用本组件。
// 只读指展示：改动一律经微调闭环（共识 Q1，防脏数据）。票 #85 起题目列表支持选中
// 单道题目作元素微调目标，选中后页面内嵌微调面板（复用既有微调链路：草稿 + 闸门
// 报告 + 确认生效），生效产生的新版本经 onApplied 由页面刷新清单。

import { useState } from "react";
import Link from "next/link";
import AdminDomainPackTemplates from "@/components/admin-domain-pack-templates";
import AdminDomainPackRefiner from "@/components/admin-domain-pack-refiner";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";
import {
  toggleTemplate,
  toggleTable,
  toggleKnowledgeArea,
  type ElementRefineTarget,
} from "@/components/element-refine-target";
import type { DifficultyTierDefinition } from "@/kernel/domain-pack-contract";
import type { ColumnDefinition, DomainPack, TableDefinition } from "@/kernel/types";

export interface AdminDomainPackDetailProps {
  /** URL 中的 packId（找不到时用于报错提示） */
  packId: string;
  /** 目标域包（展示清单中按 packId 精确命中）；null = 未命中或未就绪 */
  pack: DomainPack | null;
  /** 云端清单加载完成标记（false = 展示清单可能不全，暂按加载中呈现） */
  cloudLoaded: boolean;
  /** 难度档位定义（票 #80）：留在资产态供教师端展示（ADR-0009），由页面从资产形态解析注入；
   * 内核域包转换会丢弃该字段，缺省时分区提示无定义 */
  difficultyTiers?: DifficultyTierDefinition[];
  /** 元素微调生效后刷新展示清单（票 #85，页面注入：强制重拉云端快照，B 类新版本即时可见） */
  onRefineApplied?: () => void;
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

/** 单表的骨架卡片：语义角色 / 表名池 / 行数 / 列清单（主键列居首）；
 *  票 #87 起传入 onToggleTable 时表头出现「选中微调」按钮（含外键调整指令入口） */
function SkeletonTableCard({
  table,
  isSelected,
  onToggleTable,
}: {
  table: TableDefinition;
  /** 当前表是否为元素微调目标 */
  isSelected: boolean;
  /** 点选回调（toggle 语义）；undefined = 无选中交互（纯只读） */
  onToggleTable?: () => void;
}) {
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
      className={`卡片 rounded-2xl border p-4 ${isSelected ? "border-emerald-600 ring-1 ring-emerald-600" : "border-ink/10"} bg-paper`}
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
        {onToggleTable && (
          <button
            type="button"
            className={`ml-auto self-center rounded-full px-2 py-0.5 text-xs ${isSelected ? "bg-emerald-700 text-white" : "border border-ink/20"}`}
            data-testid={`表选中按钮-${table.tableRole}`}
            aria-pressed={isSelected}
            onClick={onToggleTable}
          >
            {isSelected ? "已选中（微调目标）" : "选中微调"}
          </button>
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

/** 单个难度档位定义卡片：级别 / 名称 / 含义描述 / 代表该档的 SQL 样例 */
function DifficultyTierCard({ tier }: { tier: DifficultyTierDefinition }) {
  return (
    <li
      className="卡片 rounded-xl border border-ink/10 bg-paper px-4 py-3"
      data-testid={`难度档位-${tier.level}`}
    >
      <p className="font-medium">
        第 {tier.level} 档 · {tier.name}
      </p>
      <p className="mt-1 text-sm text-muted">{tier.description}</p>
      <p className="mt-1 font-mono text-xs">代表样例：{tier.sampleSql}</p>
    </li>
  );
}

/** 难度档位与演练配置分区：五档定义 + 会话总题数与各档数量分布 */
function DifficultyAndConfigSection({
  difficultyTiers,
  practiceConfig,
}: {
  difficultyTiers?: DifficultyTierDefinition[];
  practiceConfig?: DomainPack["practiceConfig"];
}) {
  return (
    <section id="难度档位与演练配置" className="flex flex-col gap-3" data-testid="难度档位分区" aria-label="难度档位与演练配置">
      <h2 className="标题 text-base">难度档位与演练配置</h2>
      <p className="text-xs text-muted">
        难度 1-5 各档的含义定义（含代表该档的 SQL 样例），以及每次会话的抽题配置。两者均为 A 类改动：即时生效、不产生域包版本。
      </p>
      {difficultyTiers === undefined ? (
        <p className="text-sm text-muted">该域包暂无难度档位定义。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {difficultyTiers.map((tier) => (
            <DifficultyTierCard key={tier.level} tier={tier} />
          ))}
        </ul>
      )}
      {/* 演练配置为可选字段：内核域包兼容无配置的历史调用方，缺省回退默认抽题算法 */}
      {practiceConfig === undefined ? (
        <p className="text-sm text-muted">该域包未配置演练参数，按默认算法抽题。</p>
      ) : (
        <div className="卡片 rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm" data-testid="演练配置摘要">
          <p>
            <span className="text-muted">演练配置：</span>每次会话<span data-testid="演练配置总题数">总题数：{practiceConfig.totalQuestions} 题</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            档位分布：
            {["1", "2", "3", "4", "5"]
              .map((level) => `第 ${level} 档 ${practiceConfig.tierDistribution[level] ?? 0} 题`)
              .join("、")}
          </p>
        </div>
      )}
    </section>
  );
}

export default function AdminDomainPackDetail({
  packId,
  pack,
  cloudLoaded,
  difficultyTiers,
  onRefineApplied,
}: AdminDomainPackDetailProps) {
  // 元素微调目标（#85 单题 → #87 三类元素统一）：null = 未选中（各分区纯只读）；
  // 跨类点选互斥（toggle 纯函数保证），选中后渲染元素微调面板
  const [target, setTarget] = useState<ElementRefineTarget | null>(null);
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
          该场景的数据模型全貌：每张表的语义角色、表名池、行数与列定义（值池 / 外键引用）。可选中单张表
          作为元素微调目标（含外键调整指令），改动一律经微调闭环。
        </p>
        {pack.schemaSkeleton.map((table) => (
          <SkeletonTableCard
            key={table.tableRole}
            table={table}
            isSelected={target?.kind === "table" && target.tableRole === table.tableRole}
            onToggleTable={() => setTarget((prev) => toggleTable(prev, table.tableRole))}
          />
        ))}
      </section>
      {/* 知识点清单（票 #80）：有序清单，顺序即会话抽题推进顺序（票 #58 下放域包字段）；
          #87 起条目可选中作元素微调目标（增删/改序指令） */}
      <section id="知识点清单" className="flex flex-col gap-3" data-testid="知识点清单分区" aria-label="知识点清单">
        <h2 className="标题 text-base">知识点清单</h2>
        <p className="text-xs text-muted">
          该场景考察的知识点与推进顺序（共 {pack.knowledgeAreas?.length ?? 0} 类）：会话抽题按此顺序推进。
          可选中条目作为元素微调目标（增删/改序指令），调整后清单仍须是词表子集。
        </p>
        {pack.knowledgeAreas === undefined ? (
          <p className="text-sm text-muted">该域包未携带知识点清单。</p>
        ) : (
          <ol className="卡片 flex flex-col gap-1 rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm">
            {pack.knowledgeAreas.map((area, index) => {
              const areaSelected = target?.kind === "knowledgeArea" && target.name === area;
              return (
                <li
                  key={area}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1 ${areaSelected ? "bg-emerald-50 ring-1 ring-emerald-600" : ""}`}
                  data-testid={`知识点条目-${index}`}
                >
                  <span>
                    {index + 1}. {area}
                  </span>
                  <button
                    type="button"
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs ${areaSelected ? "bg-emerald-700 text-white" : "border border-ink/20"}`}
                    data-testid={`知识点选中按钮-${area}`}
                    aria-pressed={areaSelected}
                    onClick={() => setTarget((prev) => toggleKnowledgeArea(prev, area))}
                  >
                    {areaSelected ? "已选中（微调目标）" : "选中微调"}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {/* 题目列表分区（票 #81）：概要行 + 展开完整题；#85 起可选中单题，#87 扩为多题框选 */}
      <AdminDomainPackTemplates
        templates={pack.templates}
        selection={{
          selectedTemplateIds: target?.kind === "templates" ? target.ids : [],
          onToggleTemplate: (templateId) => setTarget((prev) => toggleTemplate(prev, templateId)),
        }}
      />
      {/* 元素微调面板（#85 → #87）：选中任一元素后内嵌，复用既有微调链路（key = 目标描述串，
          切换目标即重挂载回初始态）；生效成功后刷新清单并保留反馈 */}
      {target !== null && (
        <AdminDomainPackRefiner
          key={JSON.stringify(target)}
          packs={[pack]}
          targetBasePackId={parsePackIdVersion(pack.packId).base}
          target={target}
          onClearTarget={() => setTarget(null)}
          onApplied={onRefineApplied}
        />
      )}
      <DifficultyAndConfigSection difficultyTiers={difficultyTiers} practiceConfig={pack.practiceConfig} />
    </div>
  );
}
