// 接缝：学生端云端域包读取存储（票 #57，模块边界）——mock 浏览器 Supabase 客户端，
// 测快照语义：未就绪（空 + loaded=false，学生端仅见内置两包）、就绪后收录合法域包、
// 契约非法/与当前抽题顺序不兼容的域包静默剔除、读取失败降级空清单。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkCloudPackJson } from "@/kernel/__tests__/fixtures/cloud-domain-pack";

const selectMock = vi.fn();

vi.mock("@/lib/supabase/browser-client", () => ({
  browserClient: () => ({
    from: (table: string) => (table === "domain_pack_asset" ? { select: selectMock } : {}),
  }),
}));

import {
  cloudPackStore,
  __resetCloudPackStoreForTest,
} from "@/components/cloud-domain-pack-store";

function rowsOf(rows: unknown[]) {
  selectMock.mockResolvedValueOnce({ data: rows, error: null });
}

beforeEach(() => {
  selectMock.mockReset();
  __resetCloudPackStoreForTest();
});

describe("学生端云端域包存储（cloudPackStore）", () => {
  it("初始快照：空清单 + 未就绪——学生端首屏仅见内置两包，不闪错域包", () => {
    expect(cloudPackStore.getSnapshot()).toEqual({ packs: [], loaded: false });
    expect(cloudPackStore.getServerSnapshot()).toEqual({ packs: [], loaded: false });
  });

  it("合法域包行收录为内核域包，loaded 置真", async () => {
    rowsOf([{ pack_id: "cloud-fixture-pack", asset: mkCloudPackJson() }]);
    const notify = vi.fn();
    const unsubscribe = cloudPackStore.subscribe(notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    unsubscribe();
    const snapshot = cloudPackStore.getSnapshot();
    expect(snapshot.loaded).toBe(true);
    expect(snapshot.packs.map((d) => d.packId)).toEqual(["cloud-fixture-pack"]);
    expect(snapshot.packs[0].templates).toHaveLength(28);
  });

  it("契约非法的域包不进入加载结果（闸门口径：非法即拒）", async () => {
    rowsOf([
      { pack_id: "bad-pack", asset: mkCloudPackJson({ templates: [] }) },
      { pack_id: "cloud-fixture-pack", asset: mkCloudPackJson() },
    ]);
    const unsubscribe = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe();
    expect(cloudPackStore.getSnapshot().packs.map((d) => d.packId)).toEqual(["cloud-fixture-pack"]);
  });

  it("知识点清单含无模板条目的域包不收录（收录即开练抛错）", async () => {
    const templates = mkCloudPackJson().templates as Record<string, unknown>[];
    const hasGap = mkCloudPackJson({
      knowledgeAreas: ["自定义知识点", "空缺知识点"],
      templates: templates.map((t) => ({ ...t, knowledgeArea: "自定义知识点" })),
    });
    rowsOf([{ pack_id: "has-gap-pack", asset: hasGap }]);
    const unsubscribe = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe();
    expect(cloudPackStore.getSnapshot().packs).toEqual([]);
  });

  it("自带知识点清单（非全局七类）模板全覆盖即可收录（#58 知识点顺序下放域包字段）", async () => {
    const templates = mkCloudPackJson().templates as Record<string, unknown>[];
    const selfContained = mkCloudPackJson({
      packId: "self-contained-pack",
      knowledgeAreas: ["自定义知识点"],
      templates: templates.map((t) => ({ ...t, knowledgeArea: "自定义知识点" })),
    });
    rowsOf([{ pack_id: "self-contained-pack", asset: selfContained }]);
    const unsubscribe = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe();
    expect(cloudPackStore.getSnapshot().packs.map((d) => d.packId)).toEqual(["self-contained-pack"]);
  });

  it("云端报错/网络异常 → 降级空清单 + loaded 置真（学生端只见内置两包，不白屏不闪错）", async () => {
    selectMock.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    const unsubscribe = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe();
    expect(cloudPackStore.getSnapshot().packs).toEqual([]);

    __resetCloudPackStoreForTest();
    selectMock.mockRejectedValueOnce(new Error("network"));
    const unsubscribe2 = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe2();
    expect(cloudPackStore.getSnapshot().packs).toEqual([]);
  });

  it("重复订阅只拉取一次（幂等加载）", async () => {
    rowsOf([]);
    const u1 = cloudPackStore.subscribe(() => {});
    const u2 = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    u1();
    u2();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
