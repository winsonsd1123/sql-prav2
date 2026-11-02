"use client";

// 域包详情页（票 #78 / spec #73 子票一）：/admin/packs/<packId> 独立路由的只读结构化预览，
// URL 含 packId 可分享直达；入口在域包列表行「详情」。本票交付页面骨架（分区导航结构）
// 与库骨架分区，知识点清单 / 题目列表 / 难度档位与演练配置分区由后续票（#80/#81）补全。
// 数据取展示清单（#57 加载层合并内置 + 云端，按基础名收敛为最新版本），不加管理端只读 API。
// 守卫：admin 布局拦「访问后台」（体验层），页内再拦「域包管理」（spec #73 双权限点判定，
// 无此权限点回列表页）；只读页无变更 API，真正的安全边界仍在既有管理 API（ADR-0007）。
import { useParams } from "next/navigation";
import AdminDomainPackDetail from "@/components/admin-domain-pack-detail";
import AdminPackManageGuard from "@/components/admin-pack-manage-guard";
import { useDisplayPacks } from "@/components/use-display-packs";

export default function AdminPackDetailPage() {
  // 动态段 packId 可能含 @vN 版本后缀（Next 动态参数已自动解码，此处再 decode 兜底编码形态）
  const params = useParams<{ packId: string }>();
  const packId = decodeURIComponent(params.packId);
  const { cloud, displayPacks } = useDisplayPacks();
  const pack = displayPacks.find((d) => d.packId === packId) ?? null;

  return (
    <AdminPackManageGuard>
      <AdminDomainPackDetail packId={packId} pack={pack} cloudLoaded={cloud.loaded} />
    </AdminPackManageGuard>
  );
}
