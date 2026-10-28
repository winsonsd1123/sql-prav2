// 接缝：Route Handler（协议边界）——直接调用 POST，mock Supabase 服务端客户端工厂。
// 只测外部行为：白名单双保险、学号唯一、合法表单放行。
import { beforeEach, describe, expect, it, vi } from "vitest";

// 每个用例重置的数据表快照：表名 → 查询结果（与服务模块的真实查询形态一一对应）
const 表当前快照 = new Map<string, unknown>();

vi.mock("@/lib/supabase/服务端客户端", () => ({
  服务端特权客户端: () => ({
    from: (表名: string) => ({
      // 邮箱白名单配置 / 邮箱白名单域名 / 用户档案 的查询都以 .select(...)[.eq(...)] 结束
      select: () => ({
        eq: () => ({ async maybeSingle() { return 表当前快照.get(表名); } }),
        // 无 .eq 的清单查询：直接可 await
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(表当前快照.get(表名)).then(resolve, reject),
      }),
    }),
  }),
}));

import { POST } from "@/app/api/register-check/route";

const 合法表单 = {
  学号: "2022110001",
  姓名: "张三",
  昵称: "小张",
  邮箱: "zhang@cuc.edu.cn",
  密码: "play2026",
};

async function 提交(表单: unknown) {
  return POST(
    new Request("http://localhost/api/注册校验", {
      method: "POST",
      body: JSON.stringify(表单),
      headers: { "content-type": "application/json" },
    }) as never,
  );
}

beforeEach(() => {
  // 默认：开关关闭 + 白名单含 cuc.edu.cn + 无重号学号
  表当前快照.set("邮箱白名单配置", { data: { 放开任意域名: false } });
  表当前快照.set("邮箱白名单域名", { data: [{ 域名: "cuc.edu.cn" }] });
  表当前快照.set("用户档案", { data: null });
});

describe("注册校验路由", () => {
  it("合法表单：200 且可注册", async () => {
    const 响应 = await 提交(合法表单);
    expect(响应.status).toBe(200);
    expect(await 响应.json()).toEqual({ 可注册: true, 错误: {} });
  });

  it("白名单双保险：域名清单外邮箱被服务端拦截（即便前端已放过）", async () => {
    const 响应 = await 提交({ ...合法表单, 邮箱: "zhang@gmail.com" });
    expect(响应.status).toBe(422);
    const 载荷 = await 响应.json();
    expect(载荷.可注册).toBe(false);
    expect(载荷.错误.邮箱).toContain("白名单");
  });

  it("学号已占用：服务端报「该学号已注册」", async () => {
    表当前快照.set("用户档案", { data: { 学号: "2022110001" } });
    const 响应 = await 提交(合法表单);
    expect(响应.status).toBe(422);
    expect((await 响应.json()).错误.学号).toContain("已注册");
  });

  it("开关打开：清单外域名放行", async () => {
    表当前快照.set("邮箱白名单配置", { data: { 放开任意域名: true } });
    const 响应 = await 提交({ ...合法表单, 邮箱: "zhang@gmail.com" });
    expect(响应.status).toBe(200);
  });

  it("载荷缺字段：按空串处理并给出逐字段错误，不 500", async () => {
    const 响应 = await 提交({});
    expect(响应.status).toBe(422);
    const 错误 = (await 响应.json()).错误;
    expect(Object.keys(错误)).toEqual(["学号", "姓名", "昵称", "邮箱", "密码"]);
  });
});
