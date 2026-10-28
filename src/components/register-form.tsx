"use client";

// 注册表单（客户端）：静室主题；域名不符即时拦截（前端）+ 服务端注册校验双保险 + Supabase signUp（PKCE）。
// 注册无行为验证码（spec #22 story 6：邮箱验证已防机器）。
// 白名单配置挂载时经 GET /api/whitelist 拉取（拉不到回退最严配置），与服务端校验共用同一套判定纯函数。
import { useEffect, useMemo, useState } from "react";
import { strictestAllowlist, type AllowlistConfig } from "@/lib/email-allowlist";
import { validateRegistrationForm, type RegistrationFormErrors } from "@/lib/registration-validation";
import { browserClient } from "@/lib/supabase/browser-client";

// testid 沿用既有中文串（e2e 选择器稳定）；字段键为英文（协议与标识符英文化）
const FIELDS = [
  { key: "studentId", testid: "学号", label: "学号", placeholder: "如 2022110001", type: "text", hint: "注册后不可修改" },
  { key: "realName", testid: "姓名", label: "姓名", placeholder: "真实姓名", type: "text", hint: "仅档案展示" },
  { key: "nickname", testid: "昵称", label: "昵称", placeholder: "界面上的称呼", type: "text", hint: "可修改" },
  { key: "email", testid: "邮箱", label: "邮箱", placeholder: "name@cuc.edu.cn", type: "email", hint: "须为白名单域名邮箱" },
  { key: "password", testid: "密码", label: "密码", placeholder: "至少 8 位，含字母与数字", type: "password", hint: "至少 8 位且含字母与数字" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export default function RegisterForm() {
  const [allowlist, setAllowlist] = useState<AllowlistConfig>(strictestAllowlist);
  const [form, setForm] = useState<Record<FieldKey, string>>({
    studentId: "", realName: "", nickname: "", email: "", password: "",
  });
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [verificationEmailSent, setVerificationEmailSent] = useState(false);
  // 服务端校验回传的错误（与前端即时校验合并展示）
  const [serverErrors, setServerErrors] = useState<RegistrationFormErrors>({});

  useEffect(() => {
    fetch("/api/whitelist")
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (config) setAllowlist(config as AllowlistConfig);
      })
      .catch(() => {/* 拉不到就维持最严配置 */});
  }, []);

  // 前端即时校验：随输入逐字段重算（含域名白名单即时提示）
  const clientErrors = useMemo(
    () => validateRegistrationForm(form, allowlist),
    [form, allowlist],
  );
  const errors = { ...serverErrors, ...clientErrors }; // 前端结果覆盖，避免与重复的服务端提示打架
  const hasError = Object.keys(errors).length > 0;

  const setField = (key: FieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setServerErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttemptedSubmit(true);
    if (hasError) return; // 前端即时校验未通过：阻止提交
    setSubmitting(true);
    setSubmitError(null);
    try {
      // 服务端注册校验：白名单双保险 + 学号唯一
      const response = await fetch("/api/register-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok || !payload.registrable) {
        setServerErrors(payload.errors ?? {});
        return;
      }
      // Supabase signUp（PKCE 邮箱验证流）：开启邮箱确认时 session 为 null
      const { error } = await browserClient().auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          // 回调页路由段用 ASCII（中文路由段在 Next 16 预渲染报 InvalidCharacterError）
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          // meta 键与建档触发器约定一致（student_id/real_name/nickname）
          data: { student_id: form.studentId.trim(), real_name: form.realName.trim(), nickname: form.nickname.trim() },
        },
      });
      if (error) {
        setSubmitError(error.message);
        return;
      }
      setVerificationEmailSent(true);
    } catch {
      setSubmitError("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (verificationEmailSent) {
    return (
      <div className="卡片 入场 w-full max-w-md p-6" data-testid="验证邮件提示">
        <h2 className="标题 mb-2 text-lg">验证邮件已发送</h2>
        <p className="text-sm leading-relaxed text-muted">
          请前往 <span className="text-ink">{form.email}</span> 查收验证邮件，点击邮件中的链接完成邮箱验证后即可登录。
        </p>
        <p className="mt-2 text-xs text-muted">若几分钟内未收到，请检查垃圾邮件文件夹。</p>
      </div>
    );
  }

  return (
    <form className="卡片 入场 w-full max-w-md p-6" onSubmit={onSubmit} noValidate>
      <h1 className="标题 mb-1 text-xl">注册</h1>
      <p className="mb-4 text-xs text-muted" data-testid="白名单说明">
        仅限白名单域名邮箱（当前{allowlist.allowAnyDomain ? "已放开任意域名" : `：${allowlist.domainList.join("、") || "（清单为空）"}`}）；
        注册后需完成邮箱验证。
      </p>

      <div className="flex flex-col gap-3">
        {FIELDS.map(({ key, testid, label, placeholder, type, hint }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between text-sm font-bold">
              {label}
              <span className="text-[10px] font-normal text-muted">{hint}</span>
            </span>
            <input
              className={`输入框${errors[key] ? " 错误" : ""}`}
              type={type}
              value={form[key]}
              placeholder={placeholder}
              disabled={submitting}
              onChange={(e) => setField(key, e.target.value)}
              data-testid={`${testid}输入`}
            />
            {/* 提示时机：邮箱域名不符即时提示（story 2），其余字段在输入过或提交过后提示 */}
            {(key === "email" || attemptedSubmit || form[key] !== "") && errors[key] && (
              <span className="text-xs" style={{ color: "var(--色-错误)" }} data-testid={`错误-${testid}`}>
                {errors[key]}
              </span>
            )}
          </label>
        ))}
      </div>

      {submitError && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--色-错误) 10%, transparent)", color: "var(--色-错误)" }} data-testid="提交错误">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        className="主按钮 mt-5 w-full px-4 py-2 text-sm"
        disabled={submitting || (attemptedSubmit && hasError)}
        data-testid="注册按钮"
      >
        {submitting ? "提交中…" : "注册"}
      </button>
    </form>
  );
}
