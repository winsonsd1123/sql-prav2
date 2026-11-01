import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { loadPackA } from "@/domain-packs/student-course-grades/pack-a";
import { loadPackB } from "@/domain-packs/employee-department-salary/pack-b";
import { generatePracticeSession } from "@/kernel/question-picking";
import type { DomainPackAsset } from "@/kernel/domain-pack-contract";

// 一次性导出（票 #58，跑完即删）：把 TS 骨架 + YAML 模板程序化导出为 JSON 数据资产，
// 并固化迁移前同种子会话基线快照。难度档位名称/描述为教师可见文案，
// sampleSql 取该包内对应难度第一条模板的参考答案（同占位符口径）。

const SEVEN_AREAS = [
  "单表查询与投影",
  "条件筛选与排序",
  "聚合与分组",
  "多表 JOIN",
  "子查询",
  "日期函数",
  "综合应用",
];

const TIER_META = [
  { level: 1, name: "入门", description: "单表查询与列投影：直接从一张表取全量或指定列，不附加筛选条件" },
  { level: 2, name: "基础", description: "条件筛选与排序：使用 WHERE 过滤行、ORDER BY 排序，含去重与边界值比较" },
  { level: 3, name: "进阶", description: "聚合与分组：COUNT/SUM/AVG/MAX/MIN 聚合函数配合 GROUP BY/HAVING 分组统计" },
  { level: 4, name: "综合", description: "多表 JOIN 与子查询：跨表连接取数，或以子查询嵌套表达二层条件" },
  { level: 5, name: "挑战", description: "多条件组合的综合应用：多表连接叠加聚合/子查询/排序，需处理 NULL 与极端值边界" },
];

/** 各档配额：按模板难度占比分配 10 题（最大余数法取整，确定性） */
function tierDistribution(templates: { difficulty: number }[], total = 10): Record<string, number> {
  const counts = new Map<number, number>();
  for (const t of templates) counts.set(t.difficulty, (counts.get(t.difficulty) ?? 0) + 1);
  const raw = new Map<number, number>();
  for (const [level, n] of counts) raw.set(level, (n / templates.length) * total);
  const dist = new Map<number, number>();
  let sum = 0;
  for (const [level, r] of raw) {
    dist.set(level, Math.floor(r));
    sum += Math.floor(r);
  }
  // 余数从大到小逐档补 1（同余数按档位升序），补足 total
  const byRemainder = [...raw.entries()].sort((a, b) => (b[1] % 1) - (a[1] % 1) || a[0] - b[0]);
  for (let i = 0; sum < total; i = (i + 1) % byRemainder.length) {
    const level = byRemainder[i][0];
    if (dist.get(level)! < counts.get(level)!) {
      dist.set(level, dist.get(level)! + 1);
      sum++;
    }
  }
  return Object.fromEntries([...dist.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]) => [String(l), n]));
}

function toAsset(pack: ReturnType<typeof loadPackA>): DomainPackAsset {
  const difficultyTiers = TIER_META.map(({ level, name, description }) => ({
    level,
    name,
    description,
    sampleSql: pack.templates.find((t) => t.difficulty === level)!.referenceAnswer,
  }));
  return {
    packId: pack.packId,
    name: pack.name,
    schemaSkeleton: pack.schemaSkeleton,
    templates: pack.templates,
    knowledgeAreas: [...SEVEN_AREAS],
    difficultyTiers,
    practiceConfig: { totalQuestions: 10, tierDistribution: tierDistribution(pack.templates) },
  };
}

it("导出两包 JSON 资产与迁移前基线快照", () => {
  const packs = [loadPackA(), loadPackB()];
  const assets = packs.map(toAsset);
  writeFileSync("src/domain-packs/student-course-grades/pack-a.json", JSON.stringify(assets[0], null, 2) + "\n");
  writeFileSync("src/domain-packs/employee-department-salary/pack-b.json", JSON.stringify(assets[1], null, 2) + "\n");
  // 基线：迁移前（TS/YAML 代码态）同种子完整会话快照，供迁移后对比（字节级复现验收）
  const baseline: Record<string, unknown> = {};
  for (const pack of packs) {
    baseline[pack.packId] = [42, 43, 44].map((seed) => ({
      seed,
      practiceSession: generatePracticeSession(seed, pack),
    }));
  }
  writeFileSync(
    "src/kernel/__tests__/fixtures/builtin-pack-session-baseline.json",
    JSON.stringify(baseline, null, 2) + "\n",
  );
});
