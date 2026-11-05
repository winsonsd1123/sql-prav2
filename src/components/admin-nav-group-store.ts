"use client";

// 后台侧栏「域包组」展开状态（若依式可折叠子菜单）：localStorage 持久化，缺省展开。
// 仅宽屏展开态消费；窄屏横滑胶囊条与 rail 图标栏下子项恒直达（ADR-0012）。
import { useSyncExternalStore } from "react";
import { createLocalStorage } from "@/components/local-storage";

/** "1" = 展开 / "0" = 收起；缺省即首次默认展开 */
const PACK_GROUP_OPEN_STORAGE_KEY = "admin.nav.group.packs";
const DEFAULT_OPEN = true;

const packGroupOpenStore = createLocalStorage<boolean>({
  getKey: () => PACK_GROUP_OPEN_STORAGE_KEY,
  init: (raw) => (raw === "0" ? false : raw === "1" ? true : DEFAULT_OPEN),
  serialize: (open) => (open ? "1" : "0"),
  notReadySnapshot: DEFAULT_OPEN,
  subscribers: new Set(),
});

// 服务端快照须恒为缺省值、不可复用 getSnapshot：水合期客户端读到真值会与 SSR 输出不一致
const getServerSnapshot = () => DEFAULT_OPEN;

export function usePackGroupOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    packGroupOpenStore.subscribe,
    packGroupOpenStore.getSnapshot,
    getServerSnapshot
  );
  return [open, packGroupOpenStore.write];
}
