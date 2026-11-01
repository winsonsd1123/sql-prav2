"use client";

// 域包放出页（issue #55 / spec #53 目标③）：数据来自 GET/PUT /api/admin/pack-exposure，
// 交互与展示在 AdminPackExposureManager 独立组件（#60 的域包管理页将把该区块收纳搬迁）。
// 页面守卫与侧栏由 admin 布局提供（体验层），安全边界在 API（ADR-0007）；
// 可选域包清单注入自域包注册表（模块级客户端常量），故本页为客户端组件。
import AdminPackExposureManager from "@/components/admin-pack-exposure-manager";
import { domainPackRegistry } from "@/components/session-store";

export default function AdminPacksPage() {
  return (
    <AdminPackExposureManager
      packs={domainPackRegistry.map((d) => ({ packId: d.packId, name: d.name }))}
    />
  );
}
