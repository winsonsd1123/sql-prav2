// 邮箱白名单判定（纯函数）：开关（放开任意域名）× 域名（清单内/外）边界穷举见 __tests__/白名单.test.ts
// 供注册页前端即时提示与服务端注册校验路由共用（双保险）。

export interface 白名单配置 {
  /** 打开 = 放开任意域名注册；关闭 = 仅清单内域名可注册 */
  放开任意域名: boolean;
  /** 可配置的域名清单（可含多个域名），匹配时忽略大小写 */
  域名清单: string[];
}

export interface 白名单判定结果 {
  允许: boolean;
  /** 拦截原因（允许时无此字段） */
  原因?: string;
}

/** 最严配置：开关关闭 + 空清单（拉取失败时的回退，宁可拦截不可放过） */
export const 最严白名单: 白名单配置 = { 放开任意域名: false, 域名清单: [] };

/** 提取邮箱域名；无 @、多个 @、@ 后为空均返回 null（非法） */
function 提取域名(邮箱: string): string | null {
  const 段 = 邮箱.trim().split("@");
  if (段.length !== 2) return null;
  const 域名 = 段[1].toLowerCase().replace(/\.+$/, "");
  return 域名 === "" ? null : 域名;
}

export function 判定邮箱可注册(配置: 白名单配置, 邮箱: string): 白名单判定结果 {
  const 域名 = 提取域名(邮箱);
  if (域名 === null) return { 允许: false, 原因: "邮箱格式不正确" };
  if (配置.放开任意域名) return { 允许: true };
  // 精确域名匹配：子域名与后缀拼贴均不命中
  const 命中 = 配置.域名清单.some((d) => 提取域名(`a@${d}`) === 域名);
  if (命中) return { 允许: true };
  return { 允许: false, 原因: "邮箱域名不在白名单内" };
}
