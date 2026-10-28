// 接缝：登录服务（模块边界）——注入假的验证码核验与 Supabase 依赖，只测编排行为：
// 票据无效拒登、防枚举统一、未验证邮箱拦截、成功路径、标识解析前置。
import { describe, expect, it, vi } from "vitest";
import { performLogin, interpretCredentialError, type LoginDeps } from "@/server/login-service";

const session = { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" };
const successSessionPayload = { session, user: { id: "u1", email: "zhang@cuc.edu.cn" } };

function makeDeps(overrides: Partial<LoginDeps> = {}): LoginDeps {
  return {
    verifyCaptcha: async () => true,
    getEmailByStudentId: async (studentId: string) => (studentId === "2022110001" ? "zhang@cuc.edu.cn" : null),
    passwordLogin: async () => ({ status: "success" as const, ...successSessionPayload }),
    ...overrides,
  };
}

describe("执行登录", () => {
  it("验证码票据核验不通过：直接拒绝，不触达 Supabase", async () => {
    const passwordLogin = vi.fn();
    const result = await performLogin(
      { identifier: "2022110001", password: "play2026", captchaTicket: "假票据" },
      makeDeps({ verifyCaptcha: async () => false, passwordLogin: passwordLogin as never }),
    );
    expect(result).toEqual({ status: "captcha_failed" });
    expect(passwordLogin).not.toHaveBeenCalled();
  });

  it("标识无效：前置拒绝", async () => {
    expect(await performLogin({ identifier: "  ", password: "x", captchaTicket: "t" }, makeDeps())).toEqual({
      status: "invalid_identifier",
      reason: expect.any(String),
    });
  });

  it("学号不存在：与密码错误同为统一防枚举响应", async () => {
    const result = await performLogin(
      { identifier: "9999999999", password: "whatever1", captchaTicket: "t" },
      makeDeps(),
    );
    expect(result).toEqual({ status: "invalid_credentials" });
  });

  it("密码错误：统一防枚举响应（不区分邮箱是否存在）", async () => {
    const result = await performLogin(
      { identifier: "zhang@cuc.edu.cn", password: "wrong123", captchaTicket: "t" },
      makeDeps({ passwordLogin: async () => ({ status: "bad_credentials" }) }),
    );
    expect(result).toEqual({ status: "invalid_credentials" });
  });

  it("邮箱未验证：明确拦截提示（可区分，spec 允许）", async () => {
    const result = await performLogin(
      { identifier: "2022110001", password: "play2026", captchaTicket: "t" },
      makeDeps({ passwordLogin: async () => ({ status: "email_unconfirmed" }) }),
    );
    expect(result).toEqual({ status: "email_unconfirmed" });
  });

  it("学号登录成功：先经学号→邮箱映射再密码登录，返回登录态", async () => {
    const passwordLogin = vi.fn(async () => ({ status: "success" as const, ...successSessionPayload }));
    const result = await performLogin(
      { identifier: " 2022110001 ", password: "play2026", captchaTicket: "真票据" },
      makeDeps({ passwordLogin }),
    );
    expect(passwordLogin).toHaveBeenCalledWith("zhang@cuc.edu.cn", "play2026");
    expect(result).toEqual({ status: "success", ...successSessionPayload });
  });

  it("邮箱登录成功：直用邮箱，不查用户档案", async () => {
    const getEmailByStudentId = vi.fn();
    await performLogin(
      { identifier: "zhang@cuc.edu.cn", password: "play2026", captchaTicket: "t" },
      makeDeps({ getEmailByStudentId: getEmailByStudentId as never }),
    );
    expect(getEmailByStudentId).not.toHaveBeenCalled();
  });
});

describe("解释凭据错误（Supabase 错误 → 防枚举分类）", () => {
  it("email_not_confirmed：判为邮箱未验证", () => {
    expect(interpretCredentialError({ code: "email_not_confirmed", message: "Email not confirmed" })).toBe("email_unconfirmed");
  });

  it("invalid_credentials：判为凭据不符", () => {
    expect(interpretCredentialError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("bad_credentials");
  });

  it("网络/服务异常等未知错误：按凭据不符处理（不泄露细节）", () => {
    expect(interpretCredentialError({ code: undefined, message: "fetch failed" })).toBe("bad_credentials");
    expect(interpretCredentialError(null)).toBe("bad_credentials");
  });
});
