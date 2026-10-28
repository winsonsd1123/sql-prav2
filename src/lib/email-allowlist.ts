// 邮箱白名单判定（纯函数）：开关（放开任意域名）× 域名（清单内/外）边界穷举见 __tests__/email-allowlist.test.ts
// 供注册页前端即时提示与服务端注册校验路由共用（双保险）。

export interface AllowlistConfig {
  /** 打开 = 放开任意域名注册；关闭 = 仅清单内域名可注册 */
  allowAnyDomain: boolean;
  /** 可配置的域名清单（可含多个域名），匹配时忽略大小写 */
  domainList: string[];
}

export interface AllowlistResult {
  allowed: boolean;
  /** 拦截原因（允许时无此字段） */
  reason?: string;
}

/** 最严配置：开关关闭 + 空清单（拉取失败时的回退，宁可拦截不可放过） */
export const strictestAllowlist: AllowlistConfig = { allowAnyDomain: false, domainList: [] };

/** 提取邮箱域名；无 @、多个 @、@ 后为空均返回 null（非法） */
function extractDomain(email: string): string | null {
  const parts = email.trim().split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase().replace(/\.+$/, "");
  return domain === "" ? null : domain;
}

export function isEmailRegisterable(config: AllowlistConfig, email: string): AllowlistResult {
  const domain = extractDomain(email);
  if (domain === null) return { allowed: false, reason: "邮箱格式不正确" };
  if (config.allowAnyDomain) return { allowed: true };
  // 精确域名匹配：子域名与后缀拼贴均不命中
  const hit = config.domainList.some((d) => extractDomain(`a@${d}`) === domain);
  if (hit) return { allowed: true };
  return { allowed: false, reason: "邮箱域名不在白名单内" };
}
