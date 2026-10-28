"use client";

// 邮箱验证回调：验证邮件链接落地页（?code=…，PKCE），手动 exchangeCodeForSession 换会话并呈现成功/失败态。
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";

type 回调状态 = "换会话中" | "成功" | "失败";

function CallbackContent() {
  const 参数 = useSearchParams();
  const code = 参数.get("code");
  // 缺 code 直接判失败（初始态而非 effect 内 setState，避免级联渲染）
  const [状态, 设状态] = useState<回调状态>(code ? "换会话中" : "失败");
  const [失败原因, 设失败原因] = useState<string>(
    code ? "" : "链接中缺少验证凭证，请使用邮件中的原始链接",
  );

  useEffect(() => {
    if (!code) return;
    浏览器客户端()
      .auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) {
          设状态("失败");
          设失败原因(error.message);
        } else {
          设状态("成功");
        }
      })
      .catch(() => {
        设状态("失败");
        设失败原因("网络异常，请稍后重试");
      });
  }, [code]);

  return (
    <div className="卡片 入场 w-full max-w-md p-6 text-center">
      {状态 === "换会话中" && (
        <p className="呼吸 text-sm text-muted" data-testid="换会话中">正在完成邮箱验证…</p>
      )}
      {状态 === "成功" && (
        <div data-testid="验证成功">
          <h1 className="标题 mb-2 text-xl" style={{ color: "var(--色-通过)" }}>邮箱验证成功</h1>
          <p className="text-sm text-muted">账号已生效，即将开始练习之旅。</p>
          <Link className="主按钮 mt-5 inline-block px-4 py-2 text-sm" href="/">进入演练场</Link>
        </div>
      )}
      {状态 === "失败" && (
        <div data-testid="验证失败">
          <h1 className="标题 mb-2 text-xl" style={{ color: "var(--色-错误)" }}>邮箱验证失败</h1>
          <p className="text-sm text-muted">{失败原因 || "验证链接无效或已过期"}</p>
          <p className="mt-2 text-xs text-muted">请回到注册页重新注册，或重新发送验证邮件。</p>
        </div>
      )}
    </div>
  );
}

export default function 邮箱验证回调() {
  return (
    <Suspense fallback={<div className="卡片 w-full max-w-md p-6 text-center text-sm text-muted">加载中…</div>}>
      <CallbackContent />
    </Suspense>
  );
}
