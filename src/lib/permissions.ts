// 权限点判定（纯函数，ADR-0005 / GLOSSARY「用户与角色」）：
// 一切行为判定只认权限点、不认角色；角色只是挂载权限点的职责标签。
// 前端判定仅服务界面显隐（体验层），后端路由与 RLS 才是安全边界（ADR-0004）。

/**
 * 权限点的最小命名单元表（第一版，spec #22「RBAC 四表结构」）：
 * - 「随时查看参考答案」：唯一启用的权限点（挂载助教、教师，本票 T5 消费）；
 * - 「编辑题库」「安排练习」「查看学情」：随表预定义的占位，不挂角色（YAGNI，待对应功能实现时启用）。
 */
export const PERMISSIONS = {
  viewAnswersAnytime: "随时查看参考答案",
  editQuestionBank: "编辑题库",
  assignPractice: "安排练习",
  viewAnalytics: "查看学情",
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** 安全默认（空权限集合）：无权限点者一律走学生摩擦力规则 */
export const EMPTY_PERMISSIONS: ReadonlySet<string> = new Set<string>();

/**
 * 多角色权限并集：一人可同时持有多个角色（如 学生+助教），
 * 其能力为各角色权限点的并集；重复权限点自然去重（Set 语义）。
 */
export function mergePermissions(rolePermissions: readonly (readonly string[])[]): Set<string> {
  const set = new Set<string>();
  for (const permissions of rolePermissions) {
    for (const permission of permissions) set.add(permission);
  }
  return set;
}

/** 权限点判定：集合（Set 或数组）中持有该权限点才放行 */
export function hasPermission(held: ReadonlySet<string> | readonly string[], permission: string): boolean {
  if ("has" in held) return held.has(permission);
  return held.includes(permission);
}
