// 注册页（路由段用 ASCII：中文路由段在 Next 16 预渲染报 InvalidCharacterError）；页面壳保持极薄。
import RegisterForm from "@/components/register-form";

export const metadata = { title: "注册 · SQL 演练场" };

export default function RegisterPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <RegisterForm />
    </main>
  );
}
