// 后台导航 active 归属判定（票 #65 / spec #64 决策 3）：
// 两层导航的选中态规则从「路径严格相等」改为「当前路径所属子项」。
// 第一层直达项（用户管理 / 邮箱白名单）路径相等即选中；
// 域包管理组内：根路径即「域包列表」，且不在导航列示的生成页与微调页
// 按前缀归属规则归入「域包列表」（从列表进入的变更操作，来路可回）。
// 后续票的子项（versions / exposure / practice-config）挂上后在此登记归属，规则以单元可测方式落地。
export type AdminNavKey = "users" | "whitelist" | "packs-list";

/** 生成页与微调页不在导航列示，但路径前缀归属「域包列表」 */
const PACKS_LIST_PREFIXES = ["/admin/packs/generate", "/admin/packs/refine"] as const;

export function resolveActiveNavKey(pathname: string): AdminNavKey | null {
  // query 参数不影响归属（微调页 ?packId= 携带目标包）
  const path = pathname.split("?")[0]!;

  if (path === "/admin/users") return "users";
  if (path === "/admin/whitelist") return "whitelist";
  if (path === "/admin/packs" || PACKS_LIST_PREFIXES.includes(path as (typeof PACKS_LIST_PREFIXES)[number])) {
    return "packs-list";
  }
  return null;
}
