"use client";

// 域包管理页：放出管理（issue #55 / spec #53 目标③）与演练配置（票 #61）两个独立区块，
// 各自接入自己的管理 API（交互与展示在独立组件，#60 的域包管理页统一收纳搬迁）。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）；
// 可选域包清单注入自内置域包注册表（模块级客户端常量）；云端域包纳入放出管理见 #60。
import AdminPackExposureManager from "@/components/admin-pack-exposure-manager";
import AdminPracticeConfigManager from "@/components/admin-practice-config-manager";
import { builtinDomainPacks } from "@/components/domain-pack-registry";

export default function AdminPacksPage() {
  return (
    <div className="flex flex-col gap-6">
      <AdminPackExposureManager
        packs={builtinDomainPacks.map((d) => ({ packId: d.packId, name: d.name }))}
      />
      <AdminPracticeConfigManager />
    </div>
  );
}
