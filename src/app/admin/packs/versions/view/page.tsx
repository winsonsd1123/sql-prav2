"use client";

// 版本内容视图页（票 #86 / spec #73 子票四）：/admin/packs/versions/view?packId=<完整版本packId>
// 查看任一版本（当前 / 历史）的完整域包内容——复用详情页展示组件（#78-#81 分区渲染），
// 双数据源经服务层归口（当前资产 / domain_pack_version_history 历史资产，含 #83 之前的
// 旧字符串清单形态，归一化读取后对展示端透明）。页头明确标识当前版本（呼应 ADR-0009
// 「进行中会话停留旧版本」的解释场景）。严格只读，无变更请求。
// 守卫与安全边界同详情页（/admin/packs/[packId]）：admin 布局拦「访问后台」（体验层），
// 页内 AdminPackManageGuard 拦「域包管理」，真正的安全边界在 API（ADR-0007）。
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AdminDomainPackDetail from "@/components/admin-domain-pack-detail";
import AdminPackManageGuard from "@/components/admin-pack-manage-guard";
import { bearerHeaders, getSessionAuth } from "@/lib/admin-api-client";
import { assetToKernelPack, type DomainPackAsset } from "@/kernel/domain-pack-contract";
import { parsePackIdVersion } from "@/kernel/domain-pack-versioning";
import { buildDomainPackDiffView, type DomainPackDiffBlock, type DomainPackDiffView } from "@/kernel/domain-pack-diff";

/** 版本内容响应（与 /api/admin/domain-packs/versions/content 响应同形） */
interface VersionContent {
  asset: DomainPackAsset;
  versionLabel: string;
  isCurrent: boolean;
}

/** diff 区块分区与动作的界面文案（中文域，ADR-0006） */
const DIFF_SECTION_LABEL: Record<DomainPackDiffBlock["section"], string> = {
  table: "表",
  knowledgeArea: "知识点",
  template: "题目模板",
};
const DIFF_ACTION_LABEL: Record<DomainPackDiffBlock["action"], string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
};
/** 分类结论文案：与微调报告同口径（A/B 类分界见 ADR-0009） */
const DIFF_CLASS_LABEL: Record<DomainPackDiffView["changeClass"], string> = {
  B: "B 类改动：触及参与种子生成的内容，产生新版本",
  A: "A 类改动：仅不参与种子生成的内容变化，即时生效",
  unchanged: "与当前版本无差异",
};

/**
 * 取当前版本资产作为 diff 基准（票 #88）：版本历史 API 找 isCurrent 行 → 取其内容。
 * 任一步失败返回 null（调用方降级为 UI 弱提示，不设主流程错误态）。
 */
async function fetchCurrentVersionContent(base: string, token: string): Promise<VersionContent | null> {
  const headers = bearerHeaders(token);
  const historyResponse = await fetch(`/api/admin/domain-packs/versions?packId=${encodeURIComponent(base)}`, {
    headers,
  });
  if (!historyResponse.ok) return null;
  const historyBody = (await historyResponse.json()) as {
    versions: { packId: string; isCurrent: boolean }[] | undefined;
  };
  const currentEntry = historyBody.versions?.find((v) => v.isCurrent);
  if (currentEntry === undefined) return null;
  const response = await fetch(
    `/api/admin/domain-packs/versions/content?packId=${encodeURIComponent(currentEntry.packId)}`,
    { headers },
  );
  if (!response.ok) return null;
  return (await response.json()) as VersionContent;
}

/**
 * 版本轻量 diff 呈现（票 #88）：分类结论 + 变更区块清单，不做逐字段高亮。
 * 视图模型由内核纯函数产出（buildDomainPackDiffView），本组件只做渲染。
 */
function VersionDiffSection({ diff, fromLabel, toLabel }: { diff: DomainPackDiffView; fromLabel: string; toLabel: string }) {
  return (
    <section data-testid="版本diff区块" className="flex flex-col gap-2 rounded-lg border border-panel bg-panel/50 p-4">
      <h2 className="text-sm font-medium">与当前版本的差异（{fromLabel} → {toLabel}）</h2>
      <p
        data-testid="版本diff结论"
        className={`w-fit rounded-full px-2.5 py-0.5 text-xs ${
          diff.changeClass === "B" ? "bg-warn/10 text-warn" : "bg-panel text-muted"
        }`}
      >
        {DIFF_CLASS_LABEL[diff.changeClass]}
      </p>
      {diff.blocks.length === 0 ? (
        <p className="text-xs text-muted">无变更区块</p>
      ) : (
        <ul data-testid="版本diff清单" className="flex flex-col gap-1">
          {diff.blocks.map((block) => (
            <li
              key={`${block.section}-${block.action}-${block.key}`}
              data-testid={`diff区块-${block.section}-${block.key}`}
              className="flex items-center gap-2 text-xs"
            >
              <span className="rounded bg-panel px-1.5 py-0.5 text-muted">{DIFF_SECTION_LABEL[block.section]}</span>
              <span>{block.key}</span>
              <span
                className={
                  block.action === "added"
                    ? "text-pass"
                    : block.action === "removed"
                      ? "text-fail"
                      : "text-warn"
                }
              >
                {DIFF_ACTION_LABEL[block.action]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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

  // 轻量 diff（票 #88）：历史版本以「当前版本」为对比基准（微调闭环核对「改对了没有」
  // 的最自然参照；当前版本 packId 经版本历史 API 取 isCurrent 行——基础名在当前为 vN 时
  // 会解析到历史行，不能直接当基准）。当前版本自身不 diff（vs 自身恒为无差异）。
  // 基准取数失败不阻塞内容查看（内容本体已可用），也不设主流程错误态——
  // 但不能静默缺位：教师需能区分「与当前版本无差异」与「diff 基准取数失败」，
  // 故降级为 UI 弱提示（弱到不打扰只读主流程，留痕到足以解释 diff 为何不在）。
  const [currentContent, setCurrentContent] = useState<VersionContent | null>(null);
  const [diffBaseFailed, setDiffBaseFailed] = useState(false);
  const needDiff = content !== null && !content.isCurrent;
  useEffect(() => {
    if (!needDiff) return;
    const base = parsePackIdVersion(packId).base;
    let cancelled = false;
    (async () => {
      setCurrentContent(null);
      setDiffBaseFailed(false);
      try {
        const { token } = await getSessionAuth();
        if (!token) throw new Error("no session");
        const body = await fetchCurrentVersionContent(base, token);
        if (cancelled) return;
        if (body === null) setDiffBaseFailed(true);
        else setCurrentContent(body);
      } catch {
        if (!cancelled) setDiffBaseFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needDiff, packId]);

  // 视图模型判定全在内核纯函数：历史版本（当前页）→ 当前版本（基准）
  const diffView = useMemo(
    () =>
      content !== null && currentContent !== null
        ? buildDomainPackDiffView(content.asset, currentContent.asset)
        : null,
    [content, currentContent],
  );

  return (
    <AdminPackManageGuard>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/admin/packs/versions?packId=${encodeURIComponent(parsePackIdVersion(packId).base)}`}
            className="text-xs text-accent hover:underline"
          >
            ← 返回版本历史
          </Link>
          {/* 当前版本明确标识（票 #86 验收）：与版本列表行同口径 */}
          {content !== null && (
            <span
              data-testid="版本内容标识"
              className={`rounded-full px-2.5 py-0.5 text-xs ${content.isCurrent ? "bg-pass/10 text-pass" : "bg-panel text-muted"}`}
            >
              {content.isCurrent ? "当前版本（新会话使用）" : `历史版本 ${content.versionLabel}（旧会话钉住）`}
            </span>
          )}
        </div>
        {missingPackId && <p className="text-sm text-fail" data-testid="版本内容错误">缺少 packId 查询参数</p>}
        {error !== null && <p className="text-sm text-fail" data-testid="版本内容错误">{error}</p>}
        {content === null && error === null && <p className="呼吸 text-sm text-muted">正在加载版本内容……</p>}
        {content !== null && !content.isCurrent && currentContent === null && diffBaseFailed && (
          <p data-testid="diff基准取数失败" className="text-xs text-muted">
            差异对比暂不可用（基准版本读取失败），可刷新重试
          </p>
        )}
        {diffView !== null && content !== null && (
          <VersionDiffSection diff={diffView} fromLabel={content.versionLabel} toLabel={`当前版本 ${currentContent?.versionLabel ?? ""}`} />
        )}
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
