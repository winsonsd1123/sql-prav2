"use client";

// 域包管理页（票 #60 / spec #53 目标②，ADR-0008）：教师端域包全生命周期入口，六个区块——
// ① 生成新域包（LLM 起草 + 闸门报告 + 确认发布）② 域包列表（内置 + 云端合并概览与放出状态，
// 每行「微调」入口）③ 域包微调（票 #62：修改意图 → LLM 修改后草稿 → 闸门 + A/B 类分类 →
// 确认生效，A 类即时生效 / B 类产生新版本）④ 域包版本历史（票 #62：每个基础名可查历史版本）
// ⑤ 域包放出管理（#55 区块迁入）⑥ 演练配置管理（#61 区块迁入）。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）。
// 云端清单复用 #57 加载层（cloudPackStore，RLS authenticated 可读），不另建管理端只读 API；
// 展示清单按基础名收敛为最新版本（票 #62：微调出新版本后列表该行即新版本）。
import { useSyncExternalStore } from "react";
import { useState } from "react";
import AdminDomainPackGenerator from "@/components/admin-domain-pack-generator";
import AdminDomainPackList from "@/components/admin-domain-pack-list";
import AdminDomainPackRefiner from "@/components/admin-domain-pack-refiner";
import AdminDomainPackVersionHistory from "@/components/admin-domain-pack-version-history";
import AdminPackExposureManager from "@/components/admin-pack-exposure-manager";
import AdminPracticeConfigManager from "@/components/admin-practice-config-manager";
import {
  builtinDomainPacks,
  mergePackRegistries,
  pickLatestVersionPerBase,
} from "@/components/domain-pack-registry";
import { cloudPackStore } from "@/components/cloud-domain-pack-store";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";

export default function AdminPacksPage() {
  // 云端域包快照（#57 加载层）：未就绪时只展示内置两包，副注说明仍在加载
  const cloud = useSyncExternalStore(
    cloudPackStore.subscribe,
    cloudPackStore.getSnapshot,
    cloudPackStore.getServerSnapshot,
  );
  // 展示清单（票 #62）：合并后按基础名只留最新版本；放出/微调/版本历史等区块共用
  const displayPacks = pickLatestVersionPerBase(mergePackRegistries(builtinDomainPacks, cloud.packs));
  const builtinBaseIds = new Set(builtinDomainPacks.map((d) => d.packId));
  // 微调目标（列表行「微调」入口写入；null = 未从列表进入，微调区块自行选择）
  const [refineTarget, setRefineTarget] = useState<string | null>(null);
  const reloadCloud = () => cloudPackStore.forceReload();

  return (
    <div className="flex flex-col gap-6">
      <AdminDomainPackGenerator onPublished={reloadCloud} />
      <AdminDomainPackList
        packs={displayPacks}
        builtinBaseIds={builtinBaseIds}
        cloudLoaded={cloud.loaded}
        onRefine={(basePackId) => {
          setRefineTarget(basePackId);
          document.getElementById("域包微调区块")?.scrollIntoView({ behavior: "smooth" });
        }}
      />
      <div id="域包微调区块">
        <AdminDomainPackRefiner
          packs={displayPacks}
          targetBasePackId={refineTarget}
          onApplied={reloadCloud}
        />
      </div>
      <AdminDomainPackVersionHistory packs={displayPacks} />
      <AdminPackExposureManager
        packs={displayPacks.map((d) => {
          const { base } = parsePackIdVersion(d.packId);
          // 放出登记按基础名（版本化口径：微调不改变放出状态，清单无需跟随版本后缀）
          return { packId: base, name: d.name };
        })}
      />
      <AdminPracticeConfigManager />
    </div>
  );
}
