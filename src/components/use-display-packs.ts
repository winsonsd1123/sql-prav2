"use client";

// 域包展示清单共享 hook（code-review 去重收敛）：四个域包管理子页
// （列表 / 放出 / 微调 / 版本历史）此前逐字重复同一形状——
// useSyncExternalStore(cloudPackStore) 快照 + pickLatestVersionPerBase(mergePackRegistries(
// builtinDomainPacks, cloud.packs)) 收敛。口径：#57 加载层快照，合并内置包后
// 按基础名只留最新版本（票 #62）。返回 cloud 一并暴露 loaded（列表 / 版本历史页需判加载完成）。
import { useSyncExternalStore } from "react";
import {
  builtinDomainPacks,
  mergePackRegistries,
  pickLatestVersionPerBase,
} from "@/components/domain-pack-registry";
import { cloudPackStore } from "@/components/cloud-domain-pack-store";

export function useDisplayPacks() {
  const cloud = useSyncExternalStore(
    cloudPackStore.subscribe,
    cloudPackStore.getSnapshot,
    cloudPackStore.getServerSnapshot,
  );
  const displayPacks = pickLatestVersionPerBase(mergePackRegistries(builtinDomainPacks, cloud.packs));
  return { cloud, displayPacks };
}
