// 接缝：学生端放出清单读取存储（模块边界，issue #55）——mock 浏览器 Supabase 客户端，
// 只测三种快照语义：未就绪 null（=默认全放）、表空 null（未配置=全放）、有行 Set（过滤清单）、读取失败 null（降级全放）。
import { describe, expect, it, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/browser-client", () => ({
  browserClient: () => ({ from: fromMock }),
}));

import {
  packExposureStore,
  __resetPackExposureStoreForTest,
} from "@/components/pack-exposure-store";

function rowsOf(rows: { pack_id: string }[]) {
  // supabase-js 链式：from("pack_exposure").select("pack_id")
  selectMock.mockResolvedValueOnce({ data: rows, error: null });
}

beforeEach(() => {
  selectMock.mockReset();
  __resetPackExposureStoreForTest();
});

describe("学生端放出清单存储（packExposureStore）", () => {
  it("初始快照为 null：清单未就绪时学生端按「未配置=全放」渲染，不闪错", () => {
    expect(packExposureStore.getSnapshot()).toBeNull();
  });

  it("订阅触发拉取；表空 = 未配置 → 保持 null（默认全部放出，兼容断言）", async () => {
    rowsOf([]);
    const unsubscribe = packExposureStore.subscribe(() => {});
    await vi.waitFor(() => expect(selectMock).toHaveBeenCalled());
    unsubscribe();
    expect(packExposureStore.getSnapshot()).toBeNull();
  });

  it("有行 → 快照为放出 packId 集合", async () => {
    rowsOf([{ pack_id: "student-course-grade" }, { pack_id: "employee-department-payroll" }]);
    const notify = vi.fn();
    const unsubscribe = packExposureStore.subscribe(notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    unsubscribe();
    expect(packExposureStore.getSnapshot()).toEqual(
      new Set(["student-course-grade", "employee-department-payroll"]),
    );
  });

  it("读取失败 → 降级保持 null（全放），不抛错", async () => {
    selectMock.mockRejectedValueOnce(new Error("offline"));
    const unsubscribe = packExposureStore.subscribe(() => {});
    await vi.waitFor(() => expect(selectMock).toHaveBeenCalled());
    unsubscribe();
    expect(packExposureStore.getSnapshot()).toBeNull();
  });

  it("重复订阅只拉取一次（幂等加载）", async () => {
    rowsOf([{ pack_id: "student-course-grade" }]);
    const u1 = packExposureStore.subscribe(() => {});
    const u2 = packExposureStore.subscribe(() => {});
    await vi.waitFor(() => expect(packExposureStore.getSnapshot()).not.toBeNull());
    u1();
    u2();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
