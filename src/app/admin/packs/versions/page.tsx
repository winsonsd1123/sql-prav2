"use client";

// 域包版本历史独立页（票 #68 / spec #64）：巡检式查看从导航直达；支持 ?packId= 预选
// 基础名并自动查询（列表行「版本历史」入口跨页携带目标，#70 挂接），参数缺失或不在
// 展示清单（无效）时回退页内选择器（query 预选契约）。版本表呈现不变（区块整块沿用）。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）；
// 云端清单复用 #57 加载层（cloudPackStore），展示清单按基础名只留最新版本。
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import AdminDomainPackVersionHistory from "@/components/admin-domain-pack-version-history";
import {
  builtinDomainPacks,
  mergePackRegistries,
  pickLatestVersionPerBase,
} from "@/components/domain-pack-registry";
import { cloudPackStore } from "@/components/cloud-domain-pack-store";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";

function PackVersionsContent() {
  const searchParams = useSearchParams();
  const cloud = useSyncExternalStore(
    cloudPackStore.subscribe,
    cloudPackStore.getSnapshot,
    cloudPackStore.getServerSnapshot,
  );
  const displayPacks = pickLatestVersionPerBase(mergePackRegistries(builtinDomainPacks, cloud.packs));
  // 预选校验：packId 必须命中展示清单的基础名才预选（无效参数回退页内选择器）。
  // 云端清单未加载完成前基础名不全（预选会被误判无效），加载完成后再挂载区块，
  // key = 预选基础名保证预选只作为初始值消费、不因清单后续变化被误改。
  const requestedBase = searchParams.get("packId");
  const knownBases = new Set(displayPacks.map((d) => parsePackIdVersion(d.packId).base));
  const initialBasePackId = requestedBase !== null && knownBases.has(requestedBase) ? requestedBase : undefined;

  if (!cloud.loaded) return null;
  return (
    <AdminDomainPackVersionHistory
      key={initialBasePackId ?? "none"}
      packs={displayPacks}
      initialBasePackId={initialBasePackId}
    />
  );
}

export default function AdminPackVersionsPage() {
  // useSearchParams 在静态预渲染下需 Suspense 边界（Next app router 约定），回退渲染空区块
  return (
    <Suspense fallback={null}>
      <PackVersionsContent />
    </Suspense>
  );
}
