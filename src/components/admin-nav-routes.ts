// 后台导航路由表（code-review 双源收敛）：路由 → 导航 key 的映射此前硬编码在两处
// ——admin-nav.tsx（directItems / packGroupItems 的 href）与 admin-nav-active.ts
// （resolveActiveNavKey 的级联 + 前缀表），新增子路由须同改两处、易漏。收敛为本表
// 单一数据源：href / label / 分组 / active 前缀规则在此声明，导航渲染与 active 判定
// 均从表派生。口径见 spec #64 决策 3/4：第一层直达（用户管理 / 邮箱白名单）；
// 域包管理组四子项常显（列表占根路径）；生成 / 微调页不在导航列示，activePrefixes
// 声明其前缀归属「域包列表」。

export type AdminNavKey =
  | "users"
  | "whitelist"
  | "packs-list"
  | "packs-versions"
  | "packs-exposure"
  | "packs-practice-config";

export type AdminNavItem = {
  key: AdminNavKey;
  /** 路由路径：active 判定按路径相等匹配（根路径即本项） */
  href: string;
  label: string;
  /** 不在导航列示、但按路径相等归属本项的路由（如生成 / 微调页归「域包列表」） */
  activePrefixes?: readonly string[];
};

/** 第一层直达项（无子项的功能域） */
export const ADMIN_NAV_DIRECT_ITEMS: readonly AdminNavItem[] = [
  { key: "users", href: "/admin/users", label: "用户管理" },
  { key: "whitelist", href: "/admin/whitelist", label: "邮箱白名单" },
];

/** 域包管理组子项（列表占根路径，历史 / 放出 / 配置巡检式导航直达） */
export const ADMIN_NAV_PACK_GROUP_ITEMS: readonly AdminNavItem[] = [
  {
    key: "packs-list",
    href: "/admin/packs",
    label: "域包列表",
    activePrefixes: ["/admin/packs/generate", "/admin/packs/refine"],
  },
  { key: "packs-versions", href: "/admin/packs/versions", label: "版本历史" },
  { key: "packs-exposure", href: "/admin/packs/exposure", label: "放出管理" },
  { key: "packs-practice-config", href: "/admin/packs/practice-config", label: "演练配置" },
];
