// 注册页（路由段用 ASCII：中文路由段在 Next 16 预渲染报 InvalidCharacterError）；页面壳保持极薄。
import 注册表单 from "@/components/注册表单";

export const metadata = { title: "注册 · SQL 演练场" };

export default function 注册页() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <注册表单 />
    </main>
  );
}
