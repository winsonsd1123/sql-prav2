// 邮箱验证回调页：验证邮件链接的落地页（成功/失败态，静室风格）。
import EmailVerificationCallback from "@/components/email-verification-callback";

export const metadata = { title: "邮箱验证 · SQL 演练场" };

export default function CallbackPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <EmailVerificationCallback />
    </main>
  );
}
