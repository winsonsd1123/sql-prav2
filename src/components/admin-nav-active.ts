// 后台导航 active 归属判定（票 #65 起源，#70 登记全四子项 / spec #64 决策 3）：
// 两层导航的选中态规则从「路径严格相等」改为「当前路径所属子项」。
// 路由 → key 的映射已收敛到 admin-nav-routes.ts 单一数据源（code-review 双源修复），
// 本函数从表派生：路径相等命中（含各项 activePaths 声明的归属路由——
// 生成页 / 微调页不在导航列示，但归入「域包列表」，从列表进入的变更操作来路可回）。
import {
  ADMIN_NAV_DIRECT_ITEMS,
  ADMIN_NAV_PACK_GROUP_ITEMS,
  type AdminNavKey,
} from "@/components/admin-nav-routes";

export type { AdminNavKey };

const ALL_NAV_ITEMS = [...ADMIN_NAV_DIRECT_ITEMS, ...ADMIN_NAV_PACK_GROUP_ITEMS];

export function resolveActiveNavKey(pathname: string): AdminNavKey | null {
  for (const item of ALL_NAV_ITEMS) {
    if (item.href === pathname) return item.key;
    if (item.activePaths?.includes(pathname)) return item.key;
  }
  return null;
}
