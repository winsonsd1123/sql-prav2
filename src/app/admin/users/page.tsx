// 用户管理页骨架（T1，spec #41）：本票不连任何 API，列表与行内操作由后续票接入。
export default function AdminUsersPage() {
  return (
    <section className="卡片 p-4" data-testid="用户管理骨架">
      <h2 className="标题 mb-2 text-base">用户管理</h2>
      <p className="text-sm text-muted">
        用户列表将在此展示（学号、姓名、昵称、邮箱、角色徽章、账号状态、注册时间），支持搜索与分页。
      </p>
      <p className="mt-1 text-xs text-muted">数据接入见后续票，当前为骨架占位。</p>
    </section>
  );
}
