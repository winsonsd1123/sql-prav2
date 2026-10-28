// 接缝：登录路由（协议边界）——mock 登录服务模块，只测 HTTP 状态码与载荷映射。
import { describe, expect, it, vi, beforeEach } from "vitest";

const performLoginMock = vi.fn();

vi.mock("@/server/login-service", () => ({
  performLogin: (...args: unknown[]) => performLoginMock(...args),
}));

import { POST } from "@/app/api/auth/login/route";

function loginRequest(payload: unknown) {
  return POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    }) as never,
  );
}

const validPayload = { identifier: "2022110001", password: "play2026", captchaTicket: "票据" };

beforeEach(() => performLoginMock.mockReset());

describe("登录路由", () => {
  it("载荷原样透传业务层（identifier/password/captchaTicket）", async () => {
    performLoginMock.mockResolvedValue({ status: "invalid_credentials" });
    await loginRequest(validPayload);
    expect(performLoginMock).toHaveBeenCalledWith(validPayload);
  });

  it("成功：200 返回登录态载荷", async () => {
    performLoginMock.mockResolvedValue({
      status: "success",
      session: { access_token: "at", refresh_token: "rt" },
      user: { id: "u1", email: "zhang@cuc.edu.cn" },
    });
    const response = await loginRequest(validPayload);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: { access_token: "at", refresh_token: "rt" },
      user: { id: "u1", email: "zhang@cuc.edu.cn" },
    });
  });

  it("验证码未通过：401 通用文案", async () => {
    performLoginMock.mockResolvedValue({ status: "captcha_failed" });
    const response = await loginRequest(validPayload);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "验证码未通过，请重试" });
  });

  it("防枚举拒绝：401 统一文案", async () => {
    performLoginMock.mockResolvedValue({ status: "invalid_credentials" });
    const response = await loginRequest(validPayload);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "学号/邮箱或密码不正确" });
  });

  it("邮箱未验证：403 明确拦截提示", async () => {
    performLoginMock.mockResolvedValue({ status: "email_unconfirmed" });
    const response = await loginRequest(validPayload);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "邮箱尚未验证，请先查收验证邮件" });
  });

  it("标识无效：422 透传原因", async () => {
    performLoginMock.mockResolvedValue({ status: "invalid_identifier", reason: "请输入学号或邮箱" });
    const response = await loginRequest({ ...validPayload, identifier: "  " });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "请输入学号或邮箱" });
  });

  it("载荷不是合法 JSON：400", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/login", { method: "POST", body: "不是json" }) as never,
    );
    expect(response.status).toBe(400);
  });

  it("业务层抛异常：500 通用文案（不泄露内部细节）", async () => {
    performLoginMock.mockRejectedValueOnce(new Error("数据库炸了"));
    const response = await loginRequest(validPayload);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "登录服务暂不可用，请稍后重试" });
  });
});
