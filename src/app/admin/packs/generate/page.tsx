"use client";

// 生成新域包独立页（票 #66 / spec #64）：生成流程独占整页呈现——场景描述、同步等待、
// 闸门报告、草稿摘要、确认发布/放弃草稿全在 /admin/packs/generate 完成。
// 两个终态（发布成功 / 放弃草稿）由本页注入回跳：强制重拉云端清单后路由跳回
// /admin/packs（Next.js 路由跳转，替代旧锚点机制），教师落地即见新包或现状。
// 生成失败（502/503/闸门拒绝）不回跳——错误与表单保留在生成组件内，直接重试。
// 页面守卫由 admin 布局提供（体验层），安全边界在 API（ADR-0007）；
// 侧边导航对本路由的「域包列表」高亮归属由 #65 的 admin-nav 前缀规则处理。
import { useRouter } from "next/navigation";
import AdminDomainPackGenerator from "@/components/admin-domain-pack-generator";
import { cloudPackStore } from "@/components/cloud-domain-pack-store";

export default function AdminPackGeneratePage() {
  const router = useRouter();
  // 终态回跳：cloudPackStore 是跨路由存活的客户端 store，回列表前刷新快照纳入新包
  const returnToList = () => {
    cloudPackStore.forceReload();
    router.push("/admin/packs");
  };

  return (
    <div className="flex flex-col gap-6">
      <AdminDomainPackGenerator onPublished={returnToList} onDiscarded={returnToList} />
    </div>
  );
}
