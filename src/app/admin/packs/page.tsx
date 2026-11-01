"use client";

// 域包管理页（票 #60 / spec #53 目标②，ADR-0008）：教师端域包全生命周期入口，四个区块——
// ① 生成新域包（LLM 起草 + 闸门报告 + 确认发布）② 域包列表（内置 + 云端合并概览与放出状态）
// ③ 域包放出管理（#55 区块迁入，props 来源从内置注册表换成合并资产清单）④ 演练配置管理（#61 区块迁入）。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）。
// 云端清单复用 #57 加载层（cloudPackStore，RLS authenticated 可读），不另建管理端只读 API。
import { useSyncExternalStore } from "react";
import AdminDomainPackGenerator from "@/components/admin-domain-pack-generator";
import AdminDomainPackList from "@/components/admin-domain-pack-list";
import AdminPackExposureManager from "@/components/admin-pack-exposure-manager";
import AdminPracticeConfigManager from "@/components/admin-practice-config-manager";
import { builtinDomainPacks, mergePackRegistries } from "@/components/domain-pack-registry";
import { cloudPackStore } from "@/components/cloud-domain-pack-store";

export default function AdminPacksPage() {
  // 云端域包快照（#57 加载层）：未就绪时只展示内置两包，副注说明仍在加载
  const cloud = useSyncExternalStore(
    cloudPackStore.subscribe,
    cloudPackStore.getSnapshot,
    cloudPackStore.getServerSnapshot,
  );
  const packs = mergePackRegistries(builtinDomainPacks, cloud.packs);

  return (
    <div className="flex flex-col gap-6">
      <AdminDomainPackGenerator />
      <AdminDomainPackList builtin={builtinDomainPacks} cloud={cloud.packs} cloudLoaded={cloud.loaded} />
      <AdminPackExposureManager
        packs={packs.map((d) => ({ packId: d.packId, name: d.name }))}
      />
      <AdminPracticeConfigManager />
    </div>
  );
}
