// 邮箱白名单页骨架（T1，spec #41）：本票不连任何 API，配置读写由后续票接入。
export default function AdminWhitelistPage() {
  return (
    <section className="卡片 p-4" data-testid="邮箱白名单骨架">
      <h2 className="标题 mb-2 text-base">邮箱白名单</h2>
      <p className="text-sm text-muted">
        可注册域名清单与「放开任意域名注册」总开关将在此维护，修改前可确认当前配置。
      </p>
      <p className="mt-1 text-xs text-muted">数据接入见后续票，当前为骨架占位。</p>
    </section>
  );
}
