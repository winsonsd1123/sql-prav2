"use client";

// 进度云同步挂载点（T6 issue #28）：登录守卫内零 UI 组件——
// 有会话即启动「判定后节流云写 + 断网静默重试 + 会话恢复云端拉取」，
// 无会话/拉取失败均静默，学生本地行为（localStorage 即时缓存）不受影响。
import { useEffect, type ReactNode } from "react";
import { 浏览器客户端 } from "@/lib/supabase/浏览器客户端";
import { 创建进度同步 } from "@/lib/进度云同步";

// 零 UI：空 children 属性仅为满足 hooks 规约的组件形态识别（与 登录守卫 同构）
export default function ProgressCloudSync({}: { children?: ReactNode }) {
  useEffect(() => {
    let 停止: (() => void) | null = null;
    let 已取消 = false;
    浏览器客户端()
      .auth.getSession()
      .then(({ data }) => {
        if (已取消 || data.session === null) return; // 未登录不同步（守卫会重定向）
        const 同步 = 创建进度同步(data.session.user.id);
        同步.启动();
        停止 = 同步.停止;
      })
      .catch(() => {}); // 会话读取失败静默：本地进度照常工作
    return () => {
      已取消 = true;
      停止?.();
    };
  }, []);
  // 零 UI：占位空元素（不渲染任何可见内容；返回真实 JSX 以满足 hooks 组件识别）
  return <span hidden />;
}
