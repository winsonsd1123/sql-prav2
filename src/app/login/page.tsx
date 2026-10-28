// 登录页（路由段 ASCII）：页面壳保持极薄。
import 登录表单 from "@/components/登录表单";

export const metadata = { title: "登录 · SQL 演练场" };

export default function 登录页() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <登录表单 />
    </main>
  );
}
