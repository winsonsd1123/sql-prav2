// 重置新密码页（路由段 ASCII）：页面壳保持极薄。
import 重设密码表单 from "@/components/重设密码表单";

export const metadata = { title: "重置密码 · SQL 演练场" };

export default function 重置密码页() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <重设密码表单 />
    </main>
  );
}
