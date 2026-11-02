// 知识点词表管理独立页（issue #79 / spec #75，ADR 0010）：全局词表条目的增删改查与启停，
// 数据来自 /api/admin/knowledge-areas*（双权限点在 API 层裁决），交互在 AdminKnowledgeAreaManager 客户端组件。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）。
import AdminKnowledgeAreaManager from "@/components/admin-knowledge-area-manager";

export default function AdminKnowledgeAreaVocabPage() {
  return <AdminKnowledgeAreaManager />;
}
