"use client";

// 注册表单（客户端）：静室主题；域名不符即时拦截（前端）+ 服务端注册校验双保险 + Supabase signUp（PKCE）。
// 注册无行为验证码（spec #22 story 6：邮箱验证已防机器）。
// 白名单配置挂载时经 GET /api/whitelist 拉取（拉不到回退最严配置），与服务端校验共用同一套判定纯函数。
import { useEffect, useMemo, useState } from "react";
import { 最严白名单, type 白名单配置 } from "@/lib/白名单";
import { 校验注册表单, type 注册表单错误 } from "@/lib/注册校验";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";

const 字段列表 = [
  { 键: "学号", 标签: "学号", 占位: "如 2022110001", 类型: "text", 说明: "注册后不可修改" },
  { 键: "姓名", 标签: "姓名", 占位: "真实姓名", 类型: "text", 说明: "仅档案展示" },
  { 键: "昵称", 标签: "昵称", 占位: "界面上的称呼", 类型: "text", 说明: "可修改" },
  { 键: "邮箱", 标签: "邮箱", 占位: "name@cuc.edu.cn", 类型: "email", 说明: "须为白名单域名邮箱" },
  { 键: "密码", 标签: "密码", 占位: "至少 8 位，含字母与数字", 类型: "password", 说明: "至少 8 位且含字母与数字" },
] as const;

type 字段键 = (typeof 字段列表)[number]["键"];

export default function RegisterForm() {
  const [白名单, 设白名单] = useState<白名单配置>(最严白名单);
  const [表单, 设表单] = useState<Record<字段键, string>>({
    学号: "", 姓名: "", 昵称: "", 邮箱: "", 密码: "",
  });
  const [已尝试提交, 设已尝试提交] = useState(false);
  const [提交中, 设提交中] = useState(false);
  const [提交错误, 设提交错误] = useState<string | null>(null);
  const [验证邮件已发送, 设验证邮件已发送] = useState(false);
  // 服务端校验回传的错误（与前端即时校验合并展示）
  const [服务端错误, 设服务端错误] = useState<注册表单错误>({});

  useEffect(() => {
    fetch("/api/whitelist")
      .then((响应) => (响应.ok ? 响应.json() : null))
      .then((配置) => {
        if (配置) 设白名单(配置 as 白名单配置);
      })
      .catch(() => {/* 拉不到就维持最严配置 */});
  }, []);

  // 前端即时校验：随输入逐字段重算（含域名白名单即时提示）
  const 前端错误 = useMemo(
    () => 校验注册表单(表单, 白名单),
    [表单, 白名单],
  );
  const 错误 = { ...服务端错误, ...前端错误 }; // 前端结果覆盖，避免与重复的服务端提示打架
  const 有错 = Object.keys(错误).length > 0;

  const 设字段 = (键: 字段键, 值: string) => {
    设表单((原) => ({ ...原, [键]: 值 }));
    设服务端错误((原) => {
      if (!(键 in 原)) return 原;
      const 新 = { ...原 };
      delete 新[键];
      return 新;
    });
  };

  const 提交 = async (事件: React.FormEvent) => {
    事件.preventDefault();
    设已尝试提交(true);
    if (有错) return; // 前端即时校验未通过：阻止提交
    设提交中(true);
    设提交错误(null);
    try {
      // 服务端注册校验：白名单双保险 + 学号唯一
      const 响应 = await fetch("/api/register-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(表单),
      });
      const 载荷 = await 响应.json();
      if (!响应.ok || !载荷.可注册) {
        设服务端错误(载荷.错误 ?? {});
        return;
      }
      // Supabase signUp（PKCE 邮箱验证流）：开启邮箱确认时 session 为 null
      const { error } = await 浏览器客户端().auth.signUp({
        email: 表单.邮箱.trim(),
        password: 表单.密码,
        options: {
          // 回调页路由段用 ASCII（中文路由段在 Next 16 预渲染报 InvalidCharacterError）
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: { 学号: 表单.学号.trim(), 姓名: 表单.姓名.trim(), 昵称: 表单.昵称.trim() },
        },
      });
      if (error) {
        设提交错误(error.message);
        return;
      }
      设验证邮件已发送(true);
    } catch {
      设提交错误("网络异常，请稍后重试");
    } finally {
      设提交中(false);
    }
  };

  if (验证邮件已发送) {
    return (
      <div className="卡片 入场 w-full max-w-md p-6" data-testid="验证邮件提示">
        <h2 className="标题 mb-2 text-lg">验证邮件已发送</h2>
        <p className="text-sm leading-relaxed text-muted">
          请前往 <span className="text-ink">{表单.邮箱}</span> 查收验证邮件，点击邮件中的链接完成邮箱验证后即可登录。
        </p>
        <p className="mt-2 text-xs text-muted">若几分钟内未收到，请检查垃圾邮件文件夹。</p>
      </div>
    );
  }

  return (
    <form className="卡片 入场 w-full max-w-md p-6" onSubmit={提交} noValidate>
      <h1 className="标题 mb-1 text-xl">注册</h1>
      <p className="mb-4 text-xs text-muted" data-testid="白名单说明">
        仅限白名单域名邮箱（当前{白名单.放开任意域名 ? "已放开任意域名" : `：${白名单.域名清单.join("、") || "（清单为空）"}`}）；
        注册后需完成邮箱验证。
      </p>

      <div className="flex flex-col gap-3">
        {字段列表.map(({ 键, 标签, 占位, 类型, 说明 }) => (
          <label key={键} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between text-sm font-bold">
              {标签}
              <span className="text-[10px] font-normal text-muted">{说明}</span>
            </span>
            <input
              className={`输入框${错误[键] ? " 错误" : ""}`}
              type={类型}
              value={表单[键]}
              placeholder={占位}
              disabled={提交中}
              onChange={(e) => 设字段(键, e.target.value)}
              data-testid={`${键}输入`}
            />
            {/* 提示时机：邮箱域名不符即时提示（story 2），其余字段在输入过或提交过后提示 */}
            {(键 === "邮箱" || 已尝试提交 || 表单[键] !== "") && 错误[键] && (
              <span className="text-xs" style={{ color: "var(--色-错误)" }} data-testid={`错误-${键}`}>
                {错误[键]}
              </span>
            )}
          </label>
        ))}
      </div>

      {提交错误 && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-错误) 10%, transparent)", color: "var(--色-错误)" }} data-testid="提交错误">
          {提交错误}
        </p>
      )}

      <button
        type="submit"
        className="主按钮 mt-5 w-full px-4 py-2 text-sm"
        disabled={提交中 || (已尝试提交 && 有错)}
        data-testid="注册按钮"
      >
        {提交中 ? "提交中…" : "注册"}
      </button>
    </form>
  );
}
