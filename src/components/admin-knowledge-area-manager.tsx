"use client";

// 知识点词表管理区块（issue #79 / spec #75，ADR 0010，GLOSSARY「知识点词表」；#83 演进被引用视图与禁删）：
// 接入 /api/admin/knowledge-areas*（列表 GET / 创建 POST / 编辑 PUT / 启停 PATCH / 删除 DELETE）；
// 请求带浏览器会话的 Bearer token（ADR-0007：安全边界在服务端——本组件与所在页面均只做展示与交互，
// 双权限点「访问后台 + 知识点词表管理」在 API 层裁决，无权限者页面明示服务端文案）。
// #83：条目携带被引用域包列表（引用形态域包的引用现状）；被引用条目删除按钮禁用（服务端为权威，
// 亦拒绝并返回中文原因——界面禁用是第一道防线，避免必然被拒的请求）；
// 停用条目仍可被既有包引用、只是不能再被新圈选（ADR 0010）。
// 每次写操作成功后回读全量（写路径逐条化，无全量保存草稿态，回读保证与服务端一致）。
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getSessionAuth, readErrorMessage } from "@/lib/admin-api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** 写操作反馈 toast：固定 id 使新反馈原位替换旧反馈（同一时刻只有一条） */
const FEEDBACK_TOAST = { id: "词表提示", testId: "词表提示" };

/** 错误反馈时长 8 秒（多条拼接的长错误读得完），成功仍走默认 4 秒 */
const FEEDBACK_ERROR_TOAST = { ...FEEDBACK_TOAST, duration: 8000 };

/** 词表条目（管理视图：名称 + 描述 + 启停态 + 被引用域包列表） */
interface KnowledgeAreaEntry {
  id: string;
  name: string;
  description: string;
  active: boolean;
  /** 引用该条目的域包名称列表（未被引用为空数组） */
  referencedBy: string[];
}

/** 编辑态草稿：一次只有一个条目处于编辑中 */
interface EditingDraft {
  id: string;
  name: string;
  description: string;
}

export default function AdminKnowledgeAreaManager() {
  const [entries, setEntries] = useState<KnowledgeAreaEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editing, setEditing] = useState<EditingDraft | null>(null);
  const [busy, setBusy] = useState(false);

  /** 统一带登录态的词表请求：无会话提示重登；非 2xx 抛出服务端文案 */
  async function requestApi(path: string, init: RequestInit = {}): Promise<unknown> {
    const { token } = await getSessionAuth();
    if (!token) {
      setError("登录态已失效，请重新登录");
      throw new Error("no-session");
    }
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(path, { ...init, headers });
    if (!response.ok) throw new Error(await readErrorMessage(response, "操作失败，请稍后重试"));
    // 成功响应体本组件不消费；解析失败（如空 body/非 JSON）静默降级为 null，不阻断成功路径
    return response.json().catch(() => null);
  }

  /** 拉取词表全量（写操作成功后复用，保证展示与服务端一致） */
  const refresh = useCallback(async () => {
    try {
      const body = (await requestApi("/api/admin/knowledge-areas")) as { entries: KnowledgeAreaEntry[] } | null;
      setEntries(body?.entries ?? []);
      setError(null);
    } catch (cause) {
      // 服务端文案（如权限不足）优先透出，网络/解析异常才落通用文案
      if (cause instanceof Error && cause.message !== "no-session") setError(cause.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  /** 四个写操作（创建/编辑/启停/删除）的公共骨架：busy 防重入 → 请求 →
   *  成功清 error、成功 toast、onSuccess 收尾（如清输入/退编辑态）→ 回读全量；
   *  失败 toast 透出服务端文案（no-session 已由 requestApi 提示重登，此处不重复提示） */
  const runWrite = async (path: string, init: RequestInit, successNotice: string, onSuccess?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await requestApi(path, init);
      setError(null);
      toast.success(successNotice, FEEDBACK_TOAST);
      onSuccess?.();
      await refresh();
    } catch (cause) {
      if (cause instanceof Error && cause.message !== "no-session") toast.error(cause.message, FEEDBACK_ERROR_TOAST);
    } finally {
      setBusy(false);
    }
  };

  /** 创建条目：成功后清空新增输入并回读 */
  const create = () =>
    runWrite(
      "/api/admin/knowledge-areas",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName, description: newDescription }),
      },
      "已创建新知识点",
      () => {
        setNewName("");
        setNewDescription("");
      },
    );

  /** 保存编辑：成功后退出编辑态并回读 */
  const saveEdit = () => {
    if (!editing) return;
    return runWrite(
      `/api/admin/knowledge-areas/${editing.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editing.name, description: editing.description }),
      },
      "已保存修改",
      () => setEditing(null),
    );
  };

  /** 启停切换：停用条目仍可被既有包引用、不能再被新圈选 */
  const toggleActive = (entry: KnowledgeAreaEntry) =>
    runWrite(
      `/api/admin/knowledge-areas/${entry.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !entry.active }),
      },
      !entry.active ? `已启用「${entry.name}」` : `已停用「${entry.name}」`,
    );

  /** 删除条目（物理删除；被引用禁删属 #83） */
  const remove = (entry: KnowledgeAreaEntry) =>
    runWrite(`/api/admin/knowledge-areas/${entry.id}`, { method: "DELETE" }, `已删除「${entry.name}」`);

  if (loading) return <p className="text-sm text-muted">正在加载知识点词表……</p>;

  return (
    <Card asChild className="rounded-2xl border-ink/10 p-5">
      <section data-testid="知识点词表管理" aria-label="知识点词表管理">
        <h2 className="标题 mb-1 text-lg">知识点词表</h2>
        <p className="mb-4 text-xs text-muted">
          跨域包的知识点唯一来源：条目含名称与描述，可停用（停用后不能再被新圈选，既有引用不受影响）；被域包引用的条目不能删除，只能停用。
        </p>
        {error && (
          <p role="alert" data-testid="词表错误" className="mb-3 rounded-lg bg-fail/10 px-3 py-2 text-xs text-fail">
            {error}
          </p>
        )}

        {/* 新增表单 */}
        <div className="mb-4 flex flex-col gap-2 border-b border-border-strong pb-4 sm:flex-row">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="知识点名称（必填）"
            data-testid="新增名称输入框"
            className="次输入框 flex-1 rounded-lg px-3 py-1.5 text-sm"
          />
          <input
            type="text"
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
            placeholder="描述（可选，供生成时 AI 理解含义）"
            data-testid="新增描述输入框"
            className="次输入框 flex-1 rounded-lg px-3 py-1.5 text-sm"
          />
          <Button onClick={create} disabled={busy} data-testid="新增条目" size="sm" className="px-4">
            新增条目
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {(entries ?? []).map((entry) => (
            <li key={entry.id} data-testid="词表行">
              <div
                data-testid={`词表行-${entry.name}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/5 px-3 py-2"
              >
                {editing?.id === entry.id ? (
                  <>
                    <input
                      type="text"
                      value={editing.name}
                      onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                      data-testid="编辑名称输入框"
                      className="次输入框 flex-1 rounded-lg px-2 py-1 text-sm"
                    />
                    <input
                      type="text"
                      value={editing.description}
                      onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                      data-testid="编辑描述输入框"
                      className="次输入框 flex-1 rounded-lg px-2 py-1 text-sm"
                    />
                    <Button onClick={saveEdit} disabled={busy} data-testid="保存编辑" size="xs" className="px-3">
                      保存
                    </Button>
                    <Button onClick={() => setEditing(null)} disabled={busy} variant="outline" size="xs" className="px-3">
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-medium">{entry.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">{entry.description || "（无描述）"}</span>
                    <span
                      data-testid={`词表状态-${entry.name}`}
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        entry.active ? "bg-pass/10 text-pass" : "bg-ink/5 text-muted"
                      }`}
                    >
                      {entry.active ? "启用中" : "已停用"}
                    </span>
                    {/* 被引用视图（#83）：删除/停用前评估影响；未被引用不渲染，降噪 */}
                    {entry.referencedBy.length > 0 && (
                      <span
                        data-testid={`词表引用-${entry.name}`}
                        className="rounded-full bg-warn/10 px-2 py-0.5 text-[10px] text-warn"
                        title={`被以下域包引用：${entry.referencedBy.join("、")}`}
                      >
                        被 {entry.referencedBy.length} 个域包引用
                      </span>
                    )}
                    <Button
                      onClick={() => setEditing({ id: entry.id, name: entry.name, description: entry.description })}
                      disabled={busy}
                      variant="outline"
                      size="xs"
                      className="px-3"
                    >
                      编辑
                    </Button>
                    <Button
                      onClick={() => toggleActive(entry)}
                      disabled={busy}
                      variant="outline"
                      size="xs"
                      className="px-3"
                    >
                      {entry.active ? "停用" : "启用"}
                    </Button>
                    <Button
                      onClick={() => remove(entry)}
                      disabled={busy || entry.referencedBy.length > 0}
                      title={entry.referencedBy.length > 0 ? "已被域包引用，不能删除（只能停用）" : undefined}
                      variant="outline"
                      size="xs"
                      className="px-3 text-fail"
                    >
                      删除
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted" data-testid="词表统计">
          共 {entries?.length ?? 0} 个知识点
        </p>
      </section>
    </Card>
  );
}
