// 后台导航 active 归属判定纯函数单测（票 #65 / spec #64）：
// 覆盖两层导航的选中态规则——第一层直达项路径匹配即选中；
// 域包管理组内按「路径所属子项」判定，且不在导航列示的生成页（/admin/packs/generate）
// 与微调页（/admin/packs/refine）按前缀归属规则归入「域包列表」（spec #64 决策 3）。
// 来源：spec #64 验收标准——路径暂未建页不阻断，规则以单元可测方式落地。
import { describe, expect, it } from "vitest";
import { resolveActiveNavKey } from "@/components/admin-nav-active";

describe("resolveActiveNavKey", () => {
  it("第一层直达项：路径相等时返回对应 key", () => {
    expect(resolveActiveNavKey("/admin/users")).toBe("users");
    expect(resolveActiveNavKey("/admin/whitelist")).toBe("whitelist");
  });

  it("域包列表根路径返回 packs-list", () => {
    expect(resolveActiveNavKey("/admin/packs")).toBe("packs-list");
  });

  it("前缀归属：生成页与微调页路径高亮「域包列表」", () => {
    expect(resolveActiveNavKey("/admin/packs/generate")).toBe("packs-list");
    expect(resolveActiveNavKey("/admin/packs/refine")).toBe("packs-list");
  });

  it("微调页带 query 参数时同样归属域包列表", () => {
    expect(resolveActiveNavKey("/admin/packs/refine?packId=library-loan")).toBe("packs-list");
  });

  it("子项路径各归其 key（票 #70 挂全四子项后的归属登记）", () => {
    expect(resolveActiveNavKey("/admin/packs/versions")).toBe("packs-versions");
    expect(resolveActiveNavKey("/admin/packs/exposure")).toBe("packs-exposure");
    expect(resolveActiveNavKey("/admin/packs/practice-config")).toBe("packs-practice-config");
  });

  it("不相关的后台路径无选中项", () => {
    expect(resolveActiveNavKey("/admin")).toBeNull();
    expect(resolveActiveNavKey("/admin/other")).toBeNull();
  });
});
