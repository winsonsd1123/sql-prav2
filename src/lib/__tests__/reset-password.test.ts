// 重置密码相关纯函数测试（issue #26）：校验规则与注册共用同一套（DRY），
// 防枚举统一提示无论请求成功与否文案一致。
import { describe, expect, it } from "vitest";
import {
  validateResetEmail,
  validateNewPassword,
  RESET_REQUEST_UNIFORM_MESSAGE,
} from "@/lib/registration-validation";

describe("校验重置请求邮箱", () => {
  it("合法邮箱通过", () => {
    expect(validateResetEmail("zhang@cuc.edu.cn")).toBeNull();
  });

  it("空邮箱提示必填", () => {
    expect(validateResetEmail("")).toBe("邮箱必填");
    expect(validateResetEmail("   ")).toBe("邮箱必填");
  });

  it("格式不正确立即提示（与注册同规则）", () => {
    expect(validateResetEmail("zhangcuc")).toBe("邮箱格式不正确");
    expect(validateResetEmail("zhang cuc.edu.cn")).toBe("邮箱格式不正确");
    expect(validateResetEmail("zhang@")).toBe("邮箱格式不正确");
  });
});

describe("校验新密码（与注册密码规则共用）", () => {
  it("合法密码通过", () => {
    expect(validateNewPassword("play2026", "play2026")).toBeNull();
  });

  it("少于 8 位被拒", () => {
    expect(validateNewPassword("ab12", "ab12")).toBe("密码至少 8 位");
  });

  it("纯数字或纯字母被拒（须同时含字母与数字）", () => {
    expect(validateNewPassword("12345678", "12345678")).toBe("密码须同时包含字母与数字");
    expect(validateNewPassword("abcdefgh", "abcdefgh")).toBe("密码须同时包含字母与数字");
  });

  it("两次输入不一致被拒", () => {
    expect(validateNewPassword("play2026", "play2027")).toBe("两次输入的密码不一致");
  });

  it("空密码提示必填", () => {
    expect(validateNewPassword("", "")).toBe("密码至少 8 位");
  });
});

describe("重置请求统一提示（防枚举）", () => {
  it("是不泄露邮箱存在与否的固定文案", () => {
    expect(RESET_REQUEST_UNIFORM_MESSAGE).toContain("若该邮箱已注册");
    expect(RESET_REQUEST_UNIFORM_MESSAGE).toContain("重置密码");
  });
});
