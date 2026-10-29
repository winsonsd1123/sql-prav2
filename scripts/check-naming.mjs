#!/usr/bin/env node
// 命名语言机械检查（ADR-0006 的可自动化面），棘轮（ratchet）模式：
//   规则一（文件名）：受检目录下，路径任何一段含非 ASCII → 违规，除非路径在 fileNameBaseline。
//   规则二（标识符，棘轮）：.ts/.tsx/.mjs 内声明语句（const/let/var/function/interface/type/class/enum）
//         的标识符含非 ASCII 计数 > ratchetBaseline 记录值 → 违规。只许减、不许增；
//         修到 0 就从基线删该行，文件从此零容忍（#32 技术债逐文件清偿）。
//   规则三（DB 对象）：supabase/migrations 的 SQL 中 CREATE 对象名含非 ASCII → 违规（新迁移零容忍）。
// 注释、字符串、测试描述、界面文案的中文合法——本脚本只查标识符与对象名。
// 退出码：0 通过 / 1 有违规（CI 红灯）。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WATCHED_DIRS = ["src", "e2e", "supabase/migrations", "scripts"];
const NON_ASCII = /[^\x00-\x7F]/;
const DECL_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function|interface|type|class|enum)\s+([^\s(:=<>,;{]+)/gm;
const SQL_OBJECT_RE =
  /create\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|function|policy|trigger|index|constraint)\s+(?:if\s+not\s+exists\s+)?([^\s(]+)["]?/gi;

// 文件名基线：历史中文路径（#32），改名后删行
const fileNameBaseline = new Set([
  "src/components/SQL编辑器.tsx",
  "src/components/会话总结.tsx",
  "src/components/库浏览器.tsx",
  "src/components/对照.ts",
  "src/components/提示与答案.tsx",
  "src/components/演练场.tsx",
  "src/components/会话存储.ts",
  "src/components/差异对照.tsx",
  "src/components/进度.ts",
  "src/components/本地存储.ts",
  "src/components/__tests__/本地存储.test.ts",
  "src/components/__tests__/对照.test.ts",
  "src/components/__tests__/进度.test.ts",
  "src/components/__tests__/草稿保存器.test.ts",
  "src/kernel/防护.ts",
  "src/kernel/错误映射.ts",
  "src/kernel/worker客户端.ts",
  "src/kernel/转译.ts",
  "src/kernel/执行worker.ts",
  "src/kernel/出题.ts",
  "src/kernel/__tests__/夹具回归.test.ts",
  "src/kernel/__tests__/1055静态检查.test.ts",
  "src/kernel/__tests__/会话出题.test.ts",
  "src/kernel/__tests__/全量题库回归.test.ts",
  "src/kernel/__tests__/大查询防护.test.ts",
  "src/kernel/__tests__/行为对照.test.ts",
  "src/kernel/__tests__/模板自判.test.ts",
  "src/kernel/__tests__/判题时间一致.test.ts",
  "src/kernel/__tests__/错误映射.test.ts",
  "src/kernel/__tests__/生成确定性.test.ts",
  "src/kernel/__tests__/随机化.test.ts",
  "src/domain-packs/学生课程成绩/域包A.ts",
  "src/domain-packs/员工部门薪资/域包B.ts",
  "src/domain-packs/学生课程成绩/templates.yaml",
  "src/domain-packs/员工部门薪资/templates.yaml",
  "src/kernel/__tests__/fixtures/MySQL行为夹具.json",
  "src/kernel/__tests__/fixtures/MySQL错误夹具.json",
  "scripts/采样MySQL行为.mjs",
  "scripts/采样MySQL错误.mjs",
  "scripts/静态服务.mjs",
]);

// 标识符棘轮基线：文件 → 当前中文声明数（2026-10-29 快照，#32 清偿进度表；减到 0 删行）
const ratchetBaseline = {
  "e2e/draft-persistence.spec.ts": 4,
  "e2e/no-paste.spec.ts": 10,
  "e2e/playground-smoke.spec.ts": 13,
  "e2e/worker-execution-guard.spec.ts": 6,
  "scripts/采样MySQL行为.mjs": 14,
  "scripts/采样MySQL错误.mjs": 14,
  "scripts/静态服务.mjs": 4,
  "src/components/SQL编辑器.tsx": 12,
  "src/components/__tests__/对照.test.ts": 14,
  "src/components/__tests__/本地存储.test.ts": 13,
  "src/components/__tests__/草稿保存器.test.ts": 8,
  "src/components/__tests__/进度.test.ts": 25,
  "src/components/会话存储.ts": 19,
  "src/components/会话总结.tsx": 3,
  "src/components/对照.ts": 36,
  "src/components/差异对照.tsx": 3,
  "src/components/提示与答案.tsx": 7,
  "src/components/本地存储.ts": 7,
  "src/components/演练场.tsx": 56,
  "src/components/进度.ts": 37,
  "src/domain-packs/员工部门薪资/域包B.ts": 2,
  "src/domain-packs/学生课程成绩/域包A.ts": 2,
  "src/kernel/__tests__/1055静态检查.test.ts": 2,
  "src/kernel/__tests__/会话出题.test.ts": 12,
  "src/kernel/__tests__/全量题库回归.test.ts": 16,
  "src/kernel/__tests__/判题时间一致.test.ts": 11,
  "src/kernel/__tests__/大查询防护.test.ts": 11,
  "src/kernel/__tests__/夹具回归.test.ts": 12,
  "src/kernel/__tests__/模板自判.test.ts": 19,
  "src/kernel/__tests__/生成确定性.test.ts": 2,
  "src/kernel/__tests__/行为对照.test.ts": 19,
  "src/kernel/__tests__/随机化.test.ts": 19,
  "src/kernel/equivalence.ts": 4,
  "src/kernel/execute.ts": 14,
  "src/kernel/generate.ts": 25,
  "src/kernel/judge.ts": 9,
  "src/kernel/prng.ts": 2,
  "src/kernel/types.ts": 10,
  "src/kernel/worker客户端.ts": 21,
  "src/kernel/出题.ts": 12,
  "src/kernel/执行worker.ts": 4,
  "src/kernel/转译.ts": 28,
  "src/kernel/错误映射.ts": 83,
  "src/kernel/防护.ts": 6,
  "src/types/yaml.d.ts": 1,
};

function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const abs = join(ROOT, dir, name);
    const rel = relative(ROOT, abs);
    if (statSync(abs).isDirectory()) out.push(...collectFiles(rel));
    else out.push(rel);
  }
  return out;
}

function countNonAsciiDecls(source) {
  let count = 0;
  for (const [, ident] of source.matchAll(DECL_RE)) {
    if (NON_ASCII.test(ident)) count += 1;
  }
  return count;
}

const violations = [];
for (const dir of WATCHED_DIRS) {
  for (const rel of collectFiles(dir)) {
    // 规则一：路径段非 ASCII
    if (!fileNameBaseline.has(rel) && rel.split("/").some((seg) => NON_ASCII.test(seg))) {
      violations.push(`[文件名] ${rel} —— 命名属英文域（ADR-0006）`);
      continue;
    }

    if (/\.(ts|tsx|mjs)$/.test(rel)) {
      // 规则二：标识符棘轮
      const actual = countNonAsciiDecls(readFileSync(join(ROOT, rel), "utf8"));
      const allowed = ratchetBaseline[rel] ?? 0;
      if (actual > allowed) {
        violations.push(
          `[标识符] ${rel}: 中文声明 ${actual} 处 > 基线 ${allowed}（只许减不许增；清零后从基线删行，见 #32）`,
        );
      }
    }

    if (rel.startsWith("supabase/migrations/") && rel.endsWith(".sql")) {
      // 规则三：DB 对象名
      const sql = readFileSync(join(ROOT, rel), "utf8");
      for (const [, obj] of sql.matchAll(SQL_OBJECT_RE)) {
        if (NON_ASCII.test(obj)) {
          violations.push(`[DB对象] ${rel}: CREATE 对象名「${obj}」——数据库对象属英文域（ADR-0006）`);
        }
      }
    }
  }
}

if (violations.length) {
  console.error(`命名语言检查未通过（${violations.length} 处）：`);
  for (const line of violations) console.error("  " + line);
  process.exit(1);
}
const debt = Object.values(ratchetBaseline).reduce((a, b) => a + b, 0);
console.log(`命名语言检查通过（#32 棘轮余量 ${debt} 处中文声明、文件名基线 ${fileNameBaseline.size} 项）。`);
