"use client";

// 版本内容视图页（票 #86 / spec #73 子票四）：/admin/packs/versions/view?packId=<完整版本packId>
// 查看任一版本（当前 / 历史）的完整域包内容——复用详情页展示组件（#78-#81 分区渲染），
// 双数据源经服务层归口（当前资产 / domain_pack_version_history 历史资产，含 #83 之前的
// 旧字符串清单形态，归一化读取后对展示端透明）。页头明确标识当前版本（呼应 ADR-0009
// 「进行中会话停留旧版本」的解释场景）。严格只读，无变更请求。
// 守卫与安全边界同详情页（/admin/packs/[packId]）：admin 布局拦「访问后台」（体验层），
// 页内 AdminPackManageGuard 拦「域包管理」，真正的安全边界在 API（ADR-0007）。
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AdminDomainPackDetail from "@/components/admin-domain-pack-detail";
import AdminPackManageGuard from "@/components/admin-pack-manage-guard";
import { bearerHeaders, getSessionAuth } from "@/lib/admin-api-client";
import { assetToKernelPack, type DomainPackAsset } from "@/kernel/domain-pack-contract";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";

/** 版本内容响应（与 /api/admin/domain-packs/versions/content 响应同形） */
interface VersionContent {
  asset: DomainPackAsset;
  versionLabel: string;
  isCurrent: boolean;
}

function PackVersionViewContent() {
  const searchParams = useSearchParams();
  const packId = searchParams.get("packId") ?? "";
  const [content, setContent] = useState<VersionContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 缺参错误为派生态（不经 effect setState）：直接在渲染层给出明确提示
  const missingPackId = packId === "";

  useEffect(() => {
    if (missingPackId) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const { token } = await getSessionAuth();
        if (!token) {
          if (!cancelled) setError("登录态已失效，请重新登录");
          return;
        }
        const response = await fetch(`/api/admin/domain-packs/versions/content?packId=${encodeURIComponent(packId)}`, {
          headers: bearerHeaders(token),
        });
        if (!response.ok) {
          if (!cancelled) setError("版本内容读取失败，该版本可能已被清理");
          return;
        }
        const body = (await response.json()) as VersionContent;
        if (!cancelled) setContent(body);
      } catch {
        if (!cancelled) setError("版本内容读取失败，请重试");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packId, missingPackId]);

  return (
    <AdminPackManageGuard>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/admin/packs/versions?packId=${encodeURIComponent(parsePackIdVersion(packId).base)}`}
            className="text-xs text-sky-700 hover:underline"
          >
            ← 返回版本历史
          </Link>
          {/* 当前版本明确标识（票 #86 验收）：与版本列表行同口径 */}
          {content !== null && (
            <span
              data-testid="版本内容标识"
              className={`rounded-full px-2.5 py-0.5 text-xs ${content.isCurrent ? "bg-emerald-50 text-emerald-700" : "bg-panel text-muted"}`}
            >
              {content.isCurrent ? "当前版本（新会话使用）" : `历史版本 ${content.versionLabel}（旧会话钉住）`}
            </span>
          )}
        </div>
        {missingPackId && <p className="text-sm text-red-700" data-testid="版本内容错误">缺少 packId 查询参数</p>}
        {error !== null && <p className="text-sm text-red-700" data-testid="版本内容错误">{error}</p>}
        {content === null && error === null && <p className="呼吸 text-sm text-muted">正在加载版本内容……</p>}
        {content !== null && (
          <AdminDomainPackDetail
            packId={content.asset.packId}
            // 资产 → 内核域包（知识点清单随包透传，演练配置同）；难度档位定义留资产态注入（ADR-0009）
            pack={assetToKernelPack(content.asset)}
            cloudLoaded={true}
            difficultyTiers={content.asset.difficultyTiers}
          />
        )}
      </div>
    </AdminPackManageGuard>
  );
}

export default function AdminPackVersionViewPage() {
  // useSearchParams 在静态预渲染下需 Suspense 边界（Next app router 约定），回退渲染空区块
  return (
    <Suspense fallback={null}>
      <PackVersionViewContent />
    </Suspense>
  );
}
