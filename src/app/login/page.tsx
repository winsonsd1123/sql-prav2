// 登录页（路由段 ASCII）：页面壳保持极薄。
import LoginForm from "@/components/login-form";

export const metadata = { title: "登录 · SQL 演练场" };

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <LoginForm />
    </main>
  );
}
