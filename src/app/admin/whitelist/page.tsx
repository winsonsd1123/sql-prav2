// 邮箱白名单页（T5，spec #41）：总开关切换与域名清单增删改，
// 数据来自 GET/PUT/PATCH /api/admin/whitelist*，交互与展示在 AdminWhitelistManager 客户端组件。
import AdminWhitelistManager from "@/components/admin-whitelist-manager";

export default function AdminWhitelistPage() {
  return <AdminWhitelistManager />;
}
