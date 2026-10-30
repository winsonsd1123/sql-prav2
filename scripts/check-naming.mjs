#!/usr/bin/env node
// 命名语言机械检查（ADR-0006 的可自动化面），零容忍模式（#32 已清偿完毕，NT6 起生效）：
//   规则一（文件名）：受检目录下，路径任何一段含非 ASCII → 违规。
//   规则二（标识符）：.ts/.tsx/.mjs 内声明语句（const/let/var/function/interface/type/class/enum）
//         的标识符含非 ASCII → 违规。
//   规则三（DB 对象）：supabase/migrations 的 SQL 中 CREATE 对象名含非 ASCII → 违规。
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
    if (rel.split("/").some((seg) => NON_ASCII.test(seg))) {
      violations.push(`[文件名] ${rel} —— 命名属英文域（ADR-0006）`);
      continue;
    }

    if (/\.(ts|tsx|mjs)$/.test(rel)) {
      // 规则二：标识符棘轮
      const actual = countNonAsciiDecls(readFileSync(join(ROOT, rel), "utf8"));
      if (actual > 0) {
        violations.push(`[标识符] ${rel}: 中文声明 ${actual} 处（零容忍，见 ADR-0006 / #32）`);
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
console.log("命名语言检查通过（#32 已清偿，全库零基线）。");
