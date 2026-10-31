// /admin 索引页：重定向至用户管理页（后台默认落地，spec #41）
import { redirect } from "next/navigation";

export default function AdminIndexPage() {
  redirect("/admin/users");
}
