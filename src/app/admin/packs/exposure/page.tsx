"use client";

// 域包放出管理独立页（issue #69 / spec #64）：整块迁出旧六区块单页，行为不变——
// 空清单 = 默认全放，登记按基础名（微调不改变放出状态）。巡检式操作，导航直达、无预选无回跳。
// 展示清单沿用旧单页口径：#57 加载层（cloudPackStore）合并内置包后按基础名收敛为最新版本。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）。
import { useSyncExternalStore } from "react";
import AdminPackExposureManager from "@/components/admin-pack-exposure-manager";
import {
  builtinDomainPacks,
  mergePackRegistries,
  pickLatestVersionPerBase,
} from "@/components/domain-pack-registry";
import { cloudPackStore } from "@/components/cloud-domain-pack-store";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";

export default function AdminPackExposurePage() {
  const cloud = useSyncExternalStore(
    cloudPackStore.subscribe,
    cloudPackStore.getSnapshot,
    cloudPackStore.getServerSnapshot,
  );
  const displayPacks = pickLatestVersionPerBase(mergePackRegistries(builtinDomainPacks, cloud.packs));
  return (
    <AdminPackExposureManager
      packs={displayPacks.map((d) => {
        const { base } = parsePackIdVersion(d.packId);
        return { packId: base, name: d.name };
      })}
    />
  );
}
