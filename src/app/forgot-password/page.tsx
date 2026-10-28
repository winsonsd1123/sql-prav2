// 忘记密码请求页（路由段 ASCII）：页面壳保持极薄。
import 忘记密码表单 from "@/components/忘记密码表单";

export const metadata = { title: "忘记密码 · SQL 演练场" };

export default function 忘记密码页() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <忘记密码表单 />
    </main>
  );
}
