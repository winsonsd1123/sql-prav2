// 接缝：学生端云端域包读取存储（票 #57，模块边界）——mock 浏览器 Supabase 客户端，
// 测快照语义：未就绪（空 + loaded=false，学生端仅见内置两包）、就绪后收录合法域包、
// 契约非法/与当前抽题顺序不兼容的域包静默剔除、读取失败降级空清单。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkCloudPackJson, CLOUD_FIXTURE_KNOWLEDGE_AREAS } from "@/kernel/__tests__/fixtures/cloud-domain-pack";

const selectMock = vi.fn();
const historySelectMock = vi.fn();

vi.mock("@/lib/supabase/browser-client", () => ({
  browserClient: () => ({
    from: (table: string) =>
      table === "domain_pack_asset"
        ? { select: selectMock }
        : table === "domain_pack_version_history"
          ? { select: historySelectMock }
          : {},
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
  historySelectMock.mockReset();
  __resetCloudPackStoreForTest();
});

describe("学生端云端域包存储（cloudPackStore）", () => {
  it("初始快照：空清单 + 未就绪——学生端首屏仅见内置两包，不闪错域包", () => {
    expect(cloudPackStore.getSnapshot()).toEqual({ packs: [], historyPacks: [], loaded: false });
    expect(cloudPackStore.getServerSnapshot()).toEqual({ packs: [], historyPacks: [], loaded: false });
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

  it("词表引用形态域包正常收录，内核域包与同名称清单的自由形态逐字段一致（#83 双形态归一化读取）", async () => {
    const refForm = mkCloudPackJson({
      packId: "ref-form-pack",
      // 引用形态：引用数组与名称清单等长逐位对齐（词表语义在服务端写入路径校验，读取端只认归一化名称）
      knowledgeAreaRefIds: ["ka-1", "ka-2", "ka-3", "ka-4", "ka-5", "ka-6", "ka-7"],
    });
    rowsOf([{ pack_id: "ref-form-pack", asset: refForm }]);
    const unsubscribe = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe();
    const snapshot = cloudPackStore.getSnapshot();
    expect(snapshot.packs.map((d) => d.packId)).toEqual(["ref-form-pack"]);
    expect(snapshot.packs[0].knowledgeAreas).toEqual([...CLOUD_FIXTURE_KNOWLEDGE_AREAS]);
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
    expect(historySelectMock).toHaveBeenCalledTimes(1);
  });
});

describe("学生端云端域包存储 × 版本历史（票 #62 / ADR-0009）", () => {
  it("历史版本行收录进 historyPacks：旧 packId 会话据此解析旧内容", async () => {
    rowsOf([{ pack_id: "library-loan", asset: mkCloudPackJson({ packId: "library-loan@v2" }) }]);
    historySelectMock.mockResolvedValueOnce({
      data: [{ pack_id: "library-loan", version_label: "v1", asset: mkCloudPackJson({ packId: "library-loan" }) }],
      error: null,
    });
    const unsubscribe = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe();
    const snapshot = cloudPackStore.getSnapshot();
    expect(snapshot.packs.map((d) => d.packId)).toEqual(["library-loan@v2"]);
    expect(snapshot.historyPacks.map((d) => d.packId)).toEqual(["library-loan"]);
  });

  it("历史表读取失败/异常 → historyPacks 降级空数组（旧会话解析不到云端旧版时暂不生成，不影响新会话）", async () => {
    rowsOf([{ pack_id: "library-loan", asset: mkCloudPackJson({ packId: "library-loan@v2" }) }]);
    historySelectMock.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    const unsubscribe = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe();
    expect(cloudPackStore.getSnapshot().historyPacks).toEqual([]);

    __resetCloudPackStoreForTest();
    rowsOf([{ pack_id: "library-loan", asset: mkCloudPackJson({ packId: "library-loan@v2" }) }]);
    historySelectMock.mockRejectedValueOnce(new Error("network"));
    const unsubscribe2 = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe2();
    expect(cloudPackStore.getSnapshot().historyPacks).toEqual([]);
  });

  it("契约非法的历史行静默剔除；与当前版本同 packId 的历史行不重复收录", async () => {
    rowsOf([{ pack_id: "library-loan", asset: mkCloudPackJson({ packId: "library-loan@v2" }) }]);
    historySelectMock.mockResolvedValueOnce({
      data: [
        { pack_id: "bad", version_label: "v1", asset: mkCloudPackJson({ templates: [] }) },
        { pack_id: "library-loan@v2", version_label: "v2", asset: mkCloudPackJson({ packId: "library-loan@v2" }) },
        { pack_id: "library-loan", version_label: "v1", asset: mkCloudPackJson({ packId: "library-loan" }) },
      ],
      error: null,
    });
    const unsubscribe = cloudPackStore.subscribe(() => {});
    await vi.waitFor(() => expect(cloudPackStore.getSnapshot().loaded).toBe(true));
    unsubscribe();
    expect(cloudPackStore.getSnapshot().historyPacks.map((d) => d.packId)).toEqual(["library-loan"]);
  });
});
