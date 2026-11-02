"use client";

// 域包微调独立页（票 #67 / spec #64）：微调流程（修改意图 → 修改后草稿 → 闸门报告 →
// A/B 类生效提示 → 确认生效）独占整页呈现。跨页入口契约：?packId= 携带目标基础名，
// 页面读取后经 targetBasePackId 预选；参数缺失或不在展示清单中（无效）由组件回退页内
// 选择器兜底。终态回跳（spec #64 决策 6，与生成页双终态对称）：确认生效成功后强制重拉
// 云端清单并跳回 /admin/packs，教师落地即在列表核对新版本；微调失败不回跳（错误与表单
// 保留在组件内直接重试）。本页不进导航（入口规则：变更操作从列表进入，行内「微调」按钮
// 携 packId 跳转），导航高亮归「域包列表」。
// 守卫与侧栏由 admin 布局提供，安全边界在 API（ADR-0007）。
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AdminDomainPackRefiner from "@/components/admin-domain-pack-refiner";
import { useDisplayPacks } from "@/components/use-display-packs";
import { cloudPackStore } from "@/components/cloud-domain-pack-store";

function RefinePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const rawPackId = params.get("packId");
  const targetBasePackId = rawPackId !== null && rawPackId !== "" ? rawPackId : null;
  // 云端域包快照（#57 加载层）：展示清单按基础名只留最新版本，微调选择器选项派生其上
  const { displayPacks } = useDisplayPacks();
  // 终态回跳：cloudPackStore 跨路由存活，回列表前刷新快照纳入新版本（对齐生成页模式）
  const returnToList = () => {
    cloudPackStore.forceReload();
    router.push("/admin/packs");
  };

  return (
    <div className="flex flex-col gap-6">
      {/* key = 预选目标：URL 查询参数切换即重挂载回到预选值 */}
      <AdminDomainPackRefiner
        key={targetBasePackId ?? "none"}
        packs={displayPacks}
        targetBasePackId={targetBasePackId}
        onApplied={returnToList}
      />
    </div>
  );
}

export default function AdminPackRefinePage() {
  // useSearchParams 的 CSR bailout 要求 Suspense 边界（Next App Router 构建约束）
  return (
    <Suspense>
      <RefinePageInner />
    </Suspense>
  );
}
