"use client";

// T6 · 进度上云运行时（issue #28）：把 进度同步 纯函数策略接到真实端口上。
// 判定结果落 localStorage（既有行为不变，即时缓存与断网兜底）之外，
// 节流约 3 秒静默写云端；断网/失败静默指数退避重试、恢复在线立即冲写，全程不弹 UI；
// 会话（种子+域包）就绪或切换时从云端拉取并按「云端为准」合并恢复完整进度
//（尝试次数 / SQL 草稿 / 通过状态 / 完成分档原始数据）。不迁移旧本地数据：
// 云端无记录时保留本地现状，云端为准仅作用于同键冲突。

import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";
import { 种子存储, 域包存储, 进度存储 } from "@/components/会话存储";
import { 解析进度 } from "@/components/进度";
import {
  合并进度,
  创建进度节流器,
  初始同步状态,
  同步状态机,
  重试退避毫秒,
  type 同步状态,
} from "@/lib/进度同步";
import type { SupabaseClient } from "@supabase/supabase-js";

export const 进度表名 = "练习进度";
/** 节流窗口：每次判定后约 3 秒静默合并写（spec #22） */
export const 云写节流毫秒 = 3000;

/** 当前三元组会话标识（null = 种子未就绪，SSR/首帧） */
function 会话键(): { 用户id: string; 种子: number; 域包: string } | null {
  const 种子 = 种子存储.取快照();
  if (种子 === null) return null;
  return { 用户id: "", 种子, 域包: 域包存储.取快照() };
}

/** 进度云同步协调器：创建后调用 启动；停止 用于组件卸载清理 */
export function 创建进度同步(
  用户id: string,
  客户端: SupabaseClient = 浏览器客户端(),
): { 启动: () => void; 停止: () => void } {
  let 状态: 同步状态 = 初始同步状态();
  /** 已知云端内容基线（JSON 串）：进度等于基线不上写，防止恢复写回触发回环推送 */
  let 基线: string | null = null;
  /** 当前会话的三元组键（换一套/换域包后重置基线并重新拉取） */
  let 当前键: string | null = null;
  /** 云端拉取进行中：暂停推送，避免新会话尚未合并云端前把本地空进度推上去覆盖云端 */
  let 拉取中 = false;
  let 已停止 = false;
  const 清理: (() => void)[] = [];

  const 键三元组 = () => {
    const s = 会话键();
    return s === null ? null : { ...s, 用户id };
  };

  /** 云写（upsert，云端为准的同键覆盖写入）：成功记基线，失败走状态机静默重试 */
  const 冲写云 = async () => {
    if (已停止) return;
    const 键 = 键三元组();
    if (键 === null) return;
    const 进度 = 进度存储.取快照();
    const { error } = await 客户端
      .from(进度表名)
      .upsert({ 用户id, 种子: 键.种子, 域包: 键.域包, 进度 });
    if (已停止) return;
    if (error === null) {
      基线 = JSON.stringify(进度);
      状态 = 同步状态机(状态, { 类型: "写成功" })[0];
    } else {
      const [新状态, 动作] = 同步状态机(状态, { 类型: "写失败", 时刻: Date.now() });
      状态 = 新状态;
      if (动作 === "安排重试") 安排重试();
    }
  };

  const 安排重试 = () => {
    if (状态.阶段 !== "积压") return;
    const 延迟 = Math.max(0, 状态.下次重试 - Date.now());
    const 计时器 = setTimeout(冲写云, Math.min(延迟, 重试退避毫秒(状态.重试次数)));
    清理.push(() => clearTimeout(计时器));
  };

  /** 节流器：写回调即触发云写（写中/积压由状态机与重试兜底） */
  const 节流器 = 创建进度节流器(冲写云, 云写节流毫秒);

  /** 进度变化（判定/草稿/恢复写回）：等于基线不推；空闲/待写才排节流窗（写中不重开窗） */
  const 进度变化 = () => {
    if (已停止 || 拉取中) return;
    const 键 = 键三元组();
    // 会话尚未做过云端恢复（首帧/换一套/换域包后的新键）：等恢复完成再推
    if (键 === null || `${键.域包}:${键.种子}` !== 当前键) return;
    const 快照 = 进度存储.取快照();
    const 文 = JSON.stringify(快照);
    if (当前键 !== null && 文 === 基线) return; // 恢复写回或幂等变更，不上写
    const [新状态, 动作] = 同步状态机(状态, { 类型: "判定写入", 时刻: Date.now() });
    状态 = 新状态;
    if (动作 === "安排节流写" || 状态.阶段 === "待写") 节流器.排程(快照);
    else if (状态.阶段 === "积压") 节流器.排程(快照); // 积压中刷新载荷，重试时取最新
  };

  /** 会话（种子+域包）就绪或切换：从云端拉取恢复（云端为准合并），换会话重置基线 */
  const 恢复云端进度 = async () => {
    if (已停止) return;
    const 键 = 键三元组();
    if (键 === null) return;
    const 键串 = `${键.域包}:${键.种子}`;
    if (键串 === 当前键) return;
    当前键 = 键串;
    拉取中 = true;
    // select("*")：中文列名会触发 supabase-js 的列解析器类型报错，通配无此问题
    const { data, error } = await 客户端
      .from(进度表名)
      .select("*")
      .eq("用户id", 用户id)
      .eq("种子", 键.种子)
      .eq("域包", 键.域包)
      .maybeSingle();
    if (已停止 || 键串 !== 当前键) return; // 等待期间又换了会话，丢弃
    拉取中 = false;
    if (error !== null) return; // 拉取失败静默：保留本地（断网兜底），后续写仍以本地为准上推
    if (data === null) {
      基线 = null; // 云端无记录：不迁移、不清空本地
      return;
    }
    const 云端进度 = 解析进度(
      JSON.stringify((data as Record<string, unknown> | null)?.进度 ?? null),
    );
    const 本地 = 进度存储.取快照();
    const 合 = 合并进度(本地, 云端进度);
    基线 = JSON.stringify(合); // 恢复写回不触发推送
    if (JSON.stringify(合) !== JSON.stringify(本地)) 进度存储.写(合);
  };

  const 上线即冲写 = () => {
    if (状态.阶段 !== "积压") return;
    状态 = 同步状态机(状态, { 类型: "恢复在线", 时刻: Date.now() })[0];
    节流器.立即冲写();
  };

  return {
    启动: () => {
      清理.push(进度存储.订阅(() => 进度变化()));
      清理.push(种子存储.订阅(() => void 恢复云端进度()));
      清理.push(域包存储.订阅(() => void 恢复云端进度()));
      window.addEventListener("online", 上线即冲写);
      清理.push(() => window.removeEventListener("online", 上线即冲写));
      const 卸载冲写 = () => 节流器.立即冲写();
      window.addEventListener("beforeunload", 卸载冲写);
      清理.push(() => window.removeEventListener("beforeunload", 卸载冲写));
      void 恢复云端进度();
    },
    停止: () => {
      已停止 = true;
      节流器.立即冲写();
      while (清理.length) 清理.pop()!();
    },
  };
}
