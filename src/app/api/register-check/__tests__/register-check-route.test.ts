// 接缝：Route Handler（协议边界）——直接调用 POST，mock Supabase 服务端客户端工厂。
// 只测外部行为：白名单双保险、学号唯一、合法表单放行。
import { beforeEach, describe, expect, it, vi } from "vitest";

// 每个用例重置的数据表快照：表名 → 查询结果（与服务模块的真实查询形态一一对应）
const tableSnapshots = new Map<string, unknown>();

vi.mock("@/lib/supabase/server-client", () => ({
  serverPrivilegedClient: () => ({
    from: (table: string) => ({
      // email_allowlist_config / email_allowlist_domains / profiles 的查询都以 .select(...)[.eq(...)] 结束
      select: () => ({
        eq: () => ({ async maybeSingle() { return tableSnapshots.get(table); } }),
        // 无 .eq 的清单查询：直接可 await
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(tableSnapshots.get(table)).then(resolve, reject),
      }),
    }),
  }),
}));

import { POST } from "@/app/api/register-check/route";

const validForm = {
  studentId: "2022110001",
  realName: "张三",
  nickname: "小张",
  email: "zhang@cuc.edu.cn",
  password: "play2026",
};

async function submit(form: unknown) {
  return POST(
    new Request("http://localhost/api/register-check", {
      method: "POST",
      body: JSON.stringify(form),
      headers: { "content-type": "application/json" },
    }) as never,
  );
}

beforeEach(() => {
  // 默认：开关关闭 + 白名单含 cuc.edu.cn + 无重号学号
  tableSnapshots.set("email_allowlist_config", { data: { allow_any_domain: false } });
  tableSnapshots.set("email_allowlist_domains", { data: [{ domain: "cuc.edu.cn" }] });
  tableSnapshots.set("profiles", { data: null });
});

describe("注册校验路由", () => {
  it("合法表单：200 且可注册", async () => {
    const response = await submit(validForm);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ registrable: true, errors: {} });
  });

  it("白名单双保险：域名清单外邮箱被服务端拦截（即便前端已放过）", async () => {
    const response = await submit({ ...validForm, email: "zhang@gmail.com" });
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.registrable).toBe(false);
    expect(payload.errors.email).toContain("白名单");
  });

  it("学号已占用：服务端报「该学号已注册」", async () => {
    tableSnapshots.set("profiles", { data: { student_id: "2022110001" } });
    const response = await submit(validForm);
    expect(response.status).toBe(422);
    expect((await response.json()).errors.studentId).toContain("已注册");
  });

  it("开关打开：清单外域名放行", async () => {
    tableSnapshots.set("email_allowlist_config", { data: { allow_any_domain: true } });
    const response = await submit({ ...validForm, email: "zhang@gmail.com" });
    expect(response.status).toBe(200);
  });

  it("载荷缺字段：按空串处理并给出逐字段错误，不 500", async () => {
    const response = await submit({});
    expect(response.status).toBe(422);
    const errors = (await response.json()).errors;
    expect(Object.keys(errors)).toEqual(["studentId", "realName", "nickname", "email", "password"]);
  });
});
