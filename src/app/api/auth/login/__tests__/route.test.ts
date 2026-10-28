// 接缝：登录路由（协议边界）——mock 登录服务模块，只测 HTTP 状态码与载荷映射。
import { describe, expect, it, vi, beforeEach } from "vitest";

const 执行登录Mock = vi.fn();

vi.mock("@/服务端/登录服务", () => ({
  执行登录: (...参数: unknown[]) => 执行登录Mock(...参数),
}));

import { POST } from "@/app/api/auth/login/route";

function 登录请求(载荷: unknown) {
  return POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify(载荷),
      headers: { "content-type": "application/json" },
    }) as never,
  );
}

const 合法载荷 = { 标识: "2022110001", 密码: "play2026", 验证票据: "票据" };

beforeEach(() => 执行登录Mock.mockReset());

describe("登录路由", () => {
  it("载荷原样透传业务层（标识/密码/验证票据）", async () => {
    执行登录Mock.mockResolvedValue({ 状态: "账号或密码不正确" });
    await 登录请求(合法载荷);
    expect(执行登录Mock).toHaveBeenCalledWith(合法载荷);
  });

  it("成功：200 返回会话载荷", async () => {
    执行登录Mock.mockResolvedValue({
      状态: "成功",
      会话: { access_token: "at", refresh_token: "rt" },
      用户: { id: "u1", email: "zhang@cuc.edu.cn" },
    });
    const 响应 = await 登录请求(合法载荷);
    expect(响应.status).toBe(200);
    await expect(响应.json()).resolves.toEqual({
      会话: { access_token: "at", refresh_token: "rt" },
      用户: { id: "u1", email: "zhang@cuc.edu.cn" },
    });
  });

  it("验证码未通过：401 通用文案", async () => {
    执行登录Mock.mockResolvedValue({ 状态: "验证码未通过" });
    const 响应 = await 登录请求(合法载荷);
    expect(响应.status).toBe(401);
    await expect(响应.json()).resolves.toEqual({ 错误: "验证码未通过，请重试" });
  });

  it("防枚举拒绝：401 统一文案", async () => {
    执行登录Mock.mockResolvedValue({ 状态: "账号或密码不正确" });
    const 响应 = await 登录请求(合法载荷);
    expect(响应.status).toBe(401);
    await expect(响应.json()).resolves.toEqual({ 错误: "账号或密码不正确" });
  });

  it("邮箱未验证：403 明确拦截提示", async () => {
    执行登录Mock.mockResolvedValue({ 状态: "邮箱未验证" });
    const 响应 = await 登录请求(合法载荷);
    expect(响应.status).toBe(403);
    await expect(响应.json()).resolves.toEqual({ 错误: "邮箱尚未验证，请先查收验证邮件" });
  });

  it("标识无效：422 透传原因", async () => {
    执行登录Mock.mockResolvedValue({ 状态: "标识无效", 原因: "请输入学号或邮箱" });
    const 响应 = await 登录请求({ ...合法载荷, 标识: "  " });
    expect(响应.status).toBe(422);
    await expect(响应.json()).resolves.toEqual({ 错误: "请输入学号或邮箱" });
  });

  it("载荷不是合法 JSON：400", async () => {
    const 响应 = await POST(
      new Request("http://localhost/api/auth/login", { method: "POST", body: "不是json" }) as never,
    );
    expect(响应.status).toBe(400);
  });

  it("业务层抛异常：500 通用文案（不泄露内部细节）", async () => {
    执行登录Mock.mockRejectedValueOnce(new Error("数据库炸了"));
    const 响应 = await 登录请求(合法载荷);
    expect(响应.status).toBe(500);
    await expect(响应.json()).resolves.toEqual({ 错误: "登录服务暂不可用，请稍后重试" });
  });
});
