"use client";

// 演练配置管理独立页（issue #69 / spec #64）：整块迁出旧六区块单页，行为不变——
// 组件自取数据（/api/admin/domain-packs/practice-config），页内下拉巡检切换域包，
// 保存即时生效、不产生域包版本。巡检式操作，导航直达、无预选无回跳。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）。
import AdminPracticeConfigManager from "@/components/admin-practice-config-manager";

export default function AdminPracticeConfigPage() {
  return <AdminPracticeConfigManager />;
}
