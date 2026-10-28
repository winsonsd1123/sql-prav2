// 邮箱验证回调页：验证邮件链接的落地页（成功/失败态，静室风格）。
import 邮箱验证回调 from "@/components/邮箱验证回调";

export const metadata = { title: "邮箱验证 · SQL 演练场" };

export default function 回调页() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-10">
      <邮箱验证回调 />
    </main>
  );
}
