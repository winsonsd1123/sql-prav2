"use client";

// 知识点词表管理区块（issue #79 / spec #75，ADR 0010，GLOSSARY「知识点词表」）：
// 接入 /api/admin/knowledge-areas*（列表 GET / 创建 POST / 编辑 PUT / 启停 PATCH / 删除 DELETE）；
// 请求带浏览器会话的 Bearer token（ADR-0007：安全边界在服务端——本组件与所在页面均只做展示与交互，
// 双权限点「访问后台 + 知识点词表管理」在 API 层裁决，无权限者页面明示服务端文案）。
// 删除本票即物理删除——被引用禁删与被引用视图属 #83（引用形态尚不存在），不做不预留；
// 停用条目仍可被既有包引用、只是不能再被新圈选（ADR 0010）。
// 每次写操作成功后回读全量（写路径逐条化，无全量保存草稿态，回读保证与服务端一致）。
import { useCallback, useEffect, useState } from "react";
import { getSessionAuth, readErrorMessage } from "@/lib/admin-api-client";

/** 词表条目（管理视图：名称 + 描述 + 启停态） */
interface KnowledgeAreaEntry {
  id: string;
  name: string;
  description: string;
  active: boolean;
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
  const [notice, setNotice] = useState<string | null>(null);
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

  /** 创建条目：成功后清空新增输入并回读 */
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await requestApi("/api/admin/knowledge-areas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName, description: newDescription }),
      });
      setError(null);
      setNotice("已创建新知识点");
      setNewName("");
      setNewDescription("");
      await refresh();
    } catch (cause) {
      if (cause instanceof Error && cause.message !== "no-session") setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  /** 保存编辑：成功后退出编辑态并回读 */
  const saveEdit = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await requestApi(`/api/admin/knowledge-areas/${editing.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editing.name, description: editing.description }),
      });
      setError(null);
      setNotice("已保存修改");
      setEditing(null);
      await refresh();
    } catch (cause) {
      if (cause instanceof Error && cause.message !== "no-session") setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  /** 启停切换：停用条目仍可被既有包引用、不能再被新圈选 */
  const toggleActive = async (entry: KnowledgeAreaEntry) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await requestApi(`/api/admin/knowledge-areas/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !entry.active }),
      });
      setError(null);
      setNotice(!entry.active ? `已启用「${entry.name}」` : `已停用「${entry.name}」`);
      await refresh();
    } catch (cause) {
      if (cause instanceof Error && cause.message !== "no-session") setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  /** 删除条目（物理删除；被引用禁删属 #83） */
  const remove = async (entry: KnowledgeAreaEntry) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await requestApi(`/api/admin/knowledge-areas/${entry.id}`, { method: "DELETE" });
      setError(null);
      setNotice(`已删除「${entry.name}」`);
      await refresh();
    } catch (cause) {
      if (cause instanceof Error && cause.message !== "no-session") setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-muted">正在加载知识点词表……</p>;

  return (
    <section
      data-testid="知识点词表管理"
      aria-label="知识点词表管理"
      className="卡片 rounded-2xl border border-ink/10 bg-paper p-5"
    >
      <h2 className="标题 mb-1 text-lg">知识点词表</h2>
      <p className="mb-4 text-xs text-muted">
        跨域包的知识点唯一来源：条目含名称与描述，可停用（停用后不能再被新圈选，既有引用不受影响）。
      </p>
      {error && (
        <p role="alert" data-testid="词表提示" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" data-testid="词表提示" className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {notice}
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
        <button onClick={create} disabled={busy} data-testid="新增条目" className="主按钮 px-4 py-1.5 text-xs disabled:opacity-50">
          新增条目
        </button>
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
                  <button onClick={saveEdit} disabled={busy} data-testid="保存编辑" className="主按钮 px-3 py-1 text-xs disabled:opacity-50">
                    保存
                  </button>
                  <button onClick={() => setEditing(null)} disabled={busy} className="次按钮 px-3 py-1 text-xs disabled:opacity-50">
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className="font-medium">{entry.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">{entry.description || "（无描述）"}</span>
                  <span
                    data-testid={`词表状态-${entry.name}`}
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      entry.active ? "bg-emerald-50 text-emerald-700" : "bg-ink/5 text-muted"
                    }`}
                  >
                    {entry.active ? "启用中" : "已停用"}
                  </span>
                  <button
                    onClick={() => setEditing({ id: entry.id, name: entry.name, description: entry.description })}
                    disabled={busy}
                    className="次按钮 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => toggleActive(entry)}
                    disabled={busy}
                    className="次按钮 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    {entry.active ? "停用" : "启用"}
                  </button>
                  <button
                    onClick={() => remove(entry)}
                    disabled={busy}
                    className="次按钮 px-3 py-1 text-xs text-red-700 disabled:opacity-50"
                  >
                    删除
                  </button>
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
  );
}
