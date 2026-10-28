// 接缝：登录服务（模块边界）——注入假的验证码核验与 Supabase 依赖，只测编排行为：
// 票据无效拒登、防枚举统一、未验证邮箱拦截、成功路径、标识解析前置。
import { describe, expect, it, vi } from "vitest";
import { 执行登录, 解释凭据错误, type 登录依赖 } from "@/服务端/登录服务";

const 会话 = { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" };
const 成功会话载荷 = { 会话, 用户: { id: "u1", email: "zhang@cuc.edu.cn" } };

function 造依赖(覆盖: Partial<登录依赖> = {}): 登录依赖 {
  return {
    核验验证码: async () => true,
    按学号查邮箱: async (学号: string) => (学号 === "2022110001" ? "zhang@cuc.edu.cn" : null),
    密码登录: async () => ({ 状态: "成功" as const, ...成功会话载荷 }),
    ...覆盖,
  };
}

describe("执行登录", () => {
  it("验证码票据核验不通过：直接拒绝，不触达 Supabase", async () => {
    const 密码登录 = vi.fn();
    const 结果 = await 执行登录(
      { 标识: "2022110001", 密码: "play2026", 验证票据: "假票据" },
      造依赖({ 核验验证码: async () => false, 密码登录: 密码登录 as never }),
    );
    expect(结果).toEqual({ 状态: "验证码未通过" });
    expect(密码登录).not.toHaveBeenCalled();
  });

  it("标识无效：前置拒绝", async () => {
    expect(await 执行登录({ 标识: "  ", 密码: "x", 验证票据: "t" }, 造依赖())).toEqual({
      状态: "标识无效",
      原因: expect.any(String),
    });
  });

  it("学号不存在：与密码错误同为统一防枚举响应", async () => {
    const 结果 = await 执行登录(
      { 标识: "9999999999", 密码: "whatever1", 验证票据: "t" },
      造依赖(),
    );
    expect(结果).toEqual({ 状态: "账号或密码不正确" });
  });

  it("密码错误：统一防枚举响应（不区分邮箱是否存在）", async () => {
    const 结果 = await 执行登录(
      { 标识: "zhang@cuc.edu.cn", 密码: "wrong123", 验证票据: "t" },
      造依赖({ 密码登录: async () => ({ 状态: "凭据不符" }) }),
    );
    expect(结果).toEqual({ 状态: "账号或密码不正确" });
  });

  it("邮箱未验证：明确拦截提示（可区分，spec 允许）", async () => {
    const 结果 = await 执行登录(
      { 标识: "2022110001", 密码: "play2026", 验证票据: "t" },
      造依赖({ 密码登录: async () => ({ 状态: "邮箱未验证" }) }),
    );
    expect(结果).toEqual({ 状态: "邮箱未验证" });
  });

  it("学号登录成功：先经学号→邮箱映射再密码登录，返回会话", async () => {
    const 密码登录 = vi.fn(async () => ({ 状态: "成功" as const, ...成功会话载荷 }));
    const 结果 = await 执行登录(
      { 标识: " 2022110001 ", 密码: "play2026", 验证票据: "真票据" },
      造依赖({ 密码登录 }),
    );
    expect(密码登录).toHaveBeenCalledWith("zhang@cuc.edu.cn", "play2026");
    expect(结果).toEqual({ 状态: "成功", ...成功会话载荷 });
  });

  it("邮箱登录成功：直用邮箱，不查用户档案", async () => {
    const 按学号查邮箱 = vi.fn();
    await 执行登录(
      { 标识: "zhang@cuc.edu.cn", 密码: "play2026", 验证票据: "t" },
      造依赖({ 按学号查邮箱: 按学号查邮箱 as never }),
    );
    expect(按学号查邮箱).not.toHaveBeenCalled();
  });
});

describe("解释凭据错误（Supabase 错误 → 防枚举分类）", () => {
  it("email_not_confirmed：判为邮箱未验证", () => {
    expect(解释凭据错误({ code: "email_not_confirmed", message: "Email not confirmed" })).toBe("邮箱未验证");
  });

  it("invalid_credentials：判为凭据不符", () => {
    expect(解释凭据错误({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("凭据不符");
  });

  it("网络/服务异常等未知错误：按凭据不符处理（不泄露细节）", () => {
    expect(解释凭据错误({ code: undefined, message: "fetch failed" })).toBe("凭据不符");
    expect(解释凭据错误(null)).toBe("凭据不符");
  });
});
