// 重置新密码页（路由段 ASCII）：页面壳保持极薄。
import ResetPasswordForm from "@/components/reset-password-form";

export const metadata = { title: "重置密码 · SQL 演练场" };

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <ResetPasswordForm />
    </main>
  );
}
