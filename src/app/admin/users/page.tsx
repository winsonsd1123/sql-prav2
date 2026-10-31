// 用户管理页（T2，spec #41）：真实用户列表（搜索/分页/角色徽章/账号状态），
// 数据来自 GET /api/admin/users，交互与展示在 AdminUsersList 客户端组件。
import AdminUsersList from "@/components/admin-users-list";

export default function AdminUsersPage() {
  return <AdminUsersList />;
}
