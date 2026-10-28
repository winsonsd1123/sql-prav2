// 权限点判定（纯函数，ADR-0005 / GLOSSARY「用户与角色」）：
// 一切行为判定只认权限点、不认角色；角色只是挂载权限点的职责标签。
// 前端判定仅服务界面显隐（体验层），后端路由与 RLS 才是安全边界（ADR-0004）。

/**
 * 权限点的最小命名单元表（第一版，spec #22「RBAC 四表结构」）：
 * - 「随时查看参考答案」：唯一启用的权限点（挂载助教、教师，本票 T5 消费）；
 * - 「编辑题库」「安排练习」「查看学情」：随表预定义的占位，不挂角色（YAGNI，待对应功能实现时启用）。
 */
export const 权限点常量 = {
  随时查看参考答案: "随时查看参考答案",
  编辑题库: "编辑题库",
  安排练习: "安排练习",
  查看学情: "查看学情",
} as const;

export type 权限点名 = (typeof 权限点常量)[keyof typeof 权限点常量];

/** 安全默认（空权限集合）：无权限点者一律走学生摩擦力规则 */
export const 空权限集合: ReadonlySet<string> = new Set<string>();

/**
 * 多角色权限并集：一人可同时持有多个角色（如 学生+助教），
 * 其能力为各角色权限点的并集；重复权限点自然去重（Set 语义）。
 */
export function 汇总权限点(各角色权限: readonly (readonly string[])[]): Set<string> {
  const 集合 = new Set<string>();
  for (const 权限 of 各角色权限) {
    for (const 点 of 权限) 集合.add(点);
  }
  return 集合;
}

/** 权限点判定：集合（Set 或数组）中持有该权限点才放行 */
export function 持有权限(权限点集合: ReadonlySet<string> | readonly string[], 权限点: string): boolean {
  if ("has" in 权限点集合) return 权限点集合.has(权限点);
  return 权限点集合.includes(权限点);
}
