"use client";

// 演练配置管理区块（票 #61 / spec #53 目标②，GLOSSARY「演练配置」）：
// 教师为域包配置每次会话的总题数与各难度档位数量分布；
// 接入 GET/PUT /api/admin/domain-packs/practice-config 的真实数据（请求带 Bearer token，
// ADR-0007：安全边界与合法性校验在服务端，本组件的前端校验只为即时报错体验）。
// 保存为 A 类改动：即时生效、packId 不变、不产生域包版本历史行（ADR-0009）；
// 进行中的学生会话题目与进度不受影响，下次开练/换一套按新配置生成。
// 组件刻意独立（数据自取，不 import 注册表）：#60 的域包管理页收纳时整块搬迁即可。
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { bearerHeaders, getSessionAuth, readErrorMessage } from "@/lib/admin-api-client";

/** 写操作反馈 toast：固定 id 使新反馈原位替换旧反馈（同一时刻只有一条） */
const FEEDBACK_TOAST = { id: "演练配置提示", testId: "演练配置提示" };

/** 错误反馈时长 8 秒（多条拼接的长错误读得完），成功仍走默认 4 秒 */
const FEEDBACK_ERROR_TOAST = { ...FEEDBACK_TOAST, duration: 8000 };

/** 配置视图条目（服务端 GET 返回形状） */
interface PracticeConfigEntry {
  packId: string;
  name: string;
  practiceConfig: { totalQuestions: number; tierDistribution: Record<string, number> };
  /** 各档位现有模板数（提示「配额不得超过该档模板数」） */
  tierTemplateCounts: Record<string, number>;
}

/** 编辑草稿：总题数 + 各档配额（字符串态便于受控输入，保存前归一校验） */
interface ConfigDraft {
  totalQuestions: string;
  tiers: Record<string, string>;
}

const TIER_LABELS: Record<string, string> = { "1": "档1", "2": "档2", "3": "档3", "4": "档4", "5": "档5" };

function toDraft(entry: PracticeConfigEntry): ConfigDraft {
  return {
    totalQuestions: String(entry.practiceConfig.totalQuestions),
    tiers: Object.fromEntries(
      ["1", "2", "3", "4", "5"].map((tier) => [tier, String(entry.practiceConfig.tierDistribution[tier] ?? 0)]),
    ),
  };
}

/** 前端草稿校验：与契约同口径（正整数总题数、各档非负整数、总和一致）；
 *  配额 ≤ 该档模板数由服务端权威校验（前端在提示区展示模板数供对齐）。 */
function validateDraft(draft: ConfigDraft): string[] {
  const errors: string[] = [];
  const total = Number(draft.totalQuestions);
  if (!Number.isInteger(total) || total < 1) errors.push("总题数必须是正整数");
  let sum = 0;
  for (const tier of ["1", "2", "3", "4", "5"]) {
    const value = Number(draft.tiers[tier]);
    if (!Number.isInteger(value) || value < 0) {
      errors.push(`${TIER_LABELS[tier]}配额必须是非负整数`);
      continue;
    }
    sum += value;
  }
  if (errors.length === 0 && sum !== total) {
    errors.push(`各档配额总和（${sum}）必须等于总题数（${total}）`);
  }
  return errors;
}

export default function AdminPracticeConfigManager() {
  const [entries, setEntries] = useState<PracticeConfigEntry[] | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => entries?.find((e) => e.packId === selectedPackId) ?? null,
    [entries, selectedPackId],
  );

  /** 拉取配置视图（保存成功后复用，保证展示最新配置）；草稿随选中包同步重置 */
  const refresh = useCallback(async () => {
    try {
      const { token } = await getSessionAuth();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/domain-packs/practice-config", { headers: bearerHeaders(token) });
      if (!response.ok) {
        setError(await readErrorMessage(response, "演练配置加载失败"));
        return;
      }
      const body = (await response.json()) as { packs: PracticeConfigEntry[] };
      setEntries(body.packs);
      setError(null);
      // 选中态保持：首次取第一个包，刷新后保持当前选中；草稿重置为选中包的最新配置
      const nextSelected = selectedPackId ?? body.packs[0]?.packId ?? null;
      setSelectedPackId(nextSelected);
      const entry = body.packs.find((e) => e.packId === nextSelected) ?? null;
      setDraft(entry === null ? null : toDraft(entry));
    } catch {
      setError("演练配置加载失败，请稍后重试");
    }
  }, [selectedPackId]);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // 切换选中包：草稿重置为该包当前配置（在事件处理器里完成，不经 effect 级联渲染）
  const switchPack = useCallback(
    (packId: string) => {
      setSelectedPackId(packId);
      const entry = entries?.find((e) => e.packId === packId) ?? null;
      setDraft(entry === null ? null : toDraft(entry));
      toast.dismiss(FEEDBACK_TOAST.id);
    },
    [entries],
  );

  const draftErrors = draft === null ? [] : validateDraft(draft);
  const draftTierSum = useMemo(
    () =>
      draft === null
        ? 0
        : ["1", "2", "3", "4", "5"].reduce((sum, tier) => sum + (Number.parseInt(draft.tiers[tier], 10) || 0), 0),
    [draft],
  );

  const save = useCallback(async () => {
    if (draft === null || selectedPackId === null || draftErrors.length > 0) return;
    setSaving(true);
    try {
      const { token } = await getSessionAuth();
      if (!token) {
        setError("登录态已失效，请重新登录");
        return;
      }
      const response = await fetch("/api/admin/domain-packs/practice-config", {
        method: "PUT",
        headers: bearerHeaders(token, { "content-type": "application/json" }),
        body: JSON.stringify({
          packId: selectedPackId,
          practiceConfig: {
            totalQuestions: Number(draft.totalQuestions),
            tierDistribution: Object.fromEntries(
              ["1", "2", "3", "4", "5"].map((tier) => [tier, Number(draft.tiers[tier])]),
            ),
          },
        }),
      });
      if (!response.ok) {
        // 400/422 带服务端中文错误清单（errors 数组），展示首条并整体列出
        const body = (await response.json().catch(() => null)) as { error?: string; errors?: string[] } | null;
        const messages = body?.errors?.length ? body.errors : [body?.error ?? "演练配置保存失败"];
        toast.error(messages.join("；"), FEEDBACK_ERROR_TOAST);
        return;
      }
      setError(null);
      toast.success("已保存，学生下次开练即按新配置生成（进行中的会话不受影响）", FEEDBACK_TOAST);
      await refresh();
    } catch {
      toast.error("演练配置保存失败，请稍后重试", FEEDBACK_ERROR_TOAST);
    } finally {
      setSaving(false);
    }
  }, [draft, draftErrors.length, refresh, selectedPackId]);

  if (loading) return <p className="text-sm text-muted">正在加载演练配置……</p>;
  if (entries === null || entries.length === 0) {
    return <p className="text-sm text-muted">暂无可配置的域包。</p>;
  }

  return (
    <section
      data-testid="演练配置管理"
      aria-label="演练配置管理"
      className="卡片 rounded-2xl border border-ink/10 bg-paper p-5"
    >
      <h2 className="标题 mb-1 text-lg">演练配置</h2>
      <p className="mb-4 text-xs text-muted">
        配置每次开练的总题数与各难度档位数量（各档配额不得超过该档模板数）。保存即时生效、不产生域包版本；
        进行中的会话不受影响，学生下次开练或换一套时按新配置生成。
      </p>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-fail/10 px-3 py-2 text-xs text-fail">
          {error}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="practice-config-pack" className="text-muted">
          域包
        </label>
        <select
          id="practice-config-pack"
          value={selectedPackId ?? ""}
          onChange={(e) => switchPack(e.target.value)}
          data-testid="演练配置域包选择"
          className="rounded-lg border border-ink/15 bg-paper px-2 py-1"
        >
          {entries.map((entry) => (
            <option key={entry.packId} value={entry.packId}>
              {entry.name}（{entry.packId}）
            </option>
          ))}
        </select>
      </div>
      {draft !== null && selected !== null && (
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="practice-config-total" className="text-muted">
              总题数
            </label>
            <input
              id="practice-config-total"
              type="number"
              min={1}
              value={draft.totalQuestions}
              onChange={(e) => setDraft({ ...draft, totalQuestions: e.target.value })}
              data-testid="演练配置总题数"
              className="w-20 rounded-lg border border-ink/15 bg-paper px-2 py-1"
            />
            <span className="text-xs text-muted">当前各档合计 {draftTierSum}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {["1", "2", "3", "4", "5"].map((tier) => (
              <label key={tier} className="flex flex-col gap-1 text-xs">
                <span className="text-muted">
                  {TIER_LABELS[tier]}（模板 {selected.tierTemplateCounts[tier]}）
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft.tiers[tier]}
                  onChange={(e) => setDraft({ ...draft, tiers: { ...draft.tiers, [tier]: e.target.value } })}
                  data-testid={`演练配置档位-${tier}`}
                  className="w-20 rounded-lg border border-ink/15 bg-paper px-2 py-1 text-sm"
                />
              </label>
            ))}
          </div>
          {draftErrors.length > 0 && (
            <ul data-testid="演练配置校验提示" className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
              {draftErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || draftErrors.length > 0}
          className="主按钮 px-4 py-1.5 text-xs disabled:opacity-50"
        >
          {saving ? "保存中……" : "保存演练配置"}
        </button>
      </div>
    </section>
  );
}
