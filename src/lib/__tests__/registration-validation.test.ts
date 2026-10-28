import { describe, expect, it } from "vitest";
import { parseLoginIdentifier, validateRegistrationForm } from "@/lib/registration-validation";

const validAllowlist = { allowAnyDomain: false, domainList: ["cuc.edu.cn"] };

const validForm = {
  studentId: "2022110001",
  realName: "张三",
  nickname: "小张",
  email: "zhang@cuc.edu.cn",
  password: "sql2026play",
};

describe("注册表单校验", () => {
  it("全部合法：无任何错误", () => {
    expect(validateRegistrationForm(validForm, validAllowlist)).toEqual({});
  });

  describe("学号", () => {
    it("为空：提示必填", () => {
      expect(validateRegistrationForm({ ...validForm, studentId: "" }, validAllowlist).studentId).toContain("学号");
    });

    it("含非字母数字字符：提示仅字母数字", () => {
      expect(validateRegistrationForm({ ...validForm, studentId: "2022 110" }, validAllowlist).studentId).toBeTruthy();
      expect(validateRegistrationForm({ ...validForm, studentId: "2022-110" }, validAllowlist).studentId).toBeTruthy();
    });

    it("过短/过长：提示长度范围（4-20 位）", () => {
      expect(validateRegistrationForm({ ...validForm, studentId: "123" }, validAllowlist).studentId).toBeTruthy();
      expect(validateRegistrationForm({ ...validForm, studentId: "1".repeat(21) }, validAllowlist).studentId).toBeTruthy();
    });
  });

  describe("姓名与昵称", () => {
    it("姓名为空：提示必填", () => {
      expect(validateRegistrationForm({ ...validForm, realName: " " }, validAllowlist).realName).toBeTruthy();
    });

    it("昵称为空：提示必填", () => {
      expect(validateRegistrationForm({ ...validForm, nickname: "" }, validAllowlist).nickname).toBeTruthy();
    });

    it("昵称超过 20 字：提示过长", () => {
      expect(validateRegistrationForm({ ...validForm, nickname: "一".repeat(21) }, validAllowlist).nickname).toBeTruthy();
      expect(validateRegistrationForm({ ...validForm, nickname: "一".repeat(20) }, validAllowlist).nickname).toBeUndefined();
    });
  });

  describe("邮箱", () => {
    it("格式非法：提示格式不正确（不触及白名单）", () => {
      const error = validateRegistrationForm({ ...validForm, email: "zhang.cuc.edu.cn" }, validAllowlist).email;
      expect(error).toBe("邮箱格式不正确");
    });

    it("域名不在白名单：提示白名单拦截", () => {
      const error = validateRegistrationForm({ ...validForm, email: "zhang@gmail.com" }, validAllowlist).email;
      expect(error).toContain("白名单");
    });

    it("域名不在白名单但开关打开：不报错", () => {
      const open = { allowAnyDomain: true, domainList: ["cuc.edu.cn"] };
      expect(validateRegistrationForm({ ...validForm, email: "zhang@gmail.com" }, open).email).toBeUndefined();
    });
  });

  describe("密码", () => {
    it("不足 8 位：提示长度", () => {
      expect(validateRegistrationForm({ ...validForm, password: "a1b2c3d" }, validAllowlist).password).toBeTruthy();
    });

    it("纯数字 / 纯字母：提示强度不足（须同时含字母与数字）", () => {
      expect(validateRegistrationForm({ ...validForm, password: "12345678" }, validAllowlist).password).toBeTruthy();
      expect(validateRegistrationForm({ ...validForm, password: "abcdefgh" }, validAllowlist).password).toBeTruthy();
    });

    it("8 位以上且含字母与数字：通过", () => {
      expect(validateRegistrationForm({ ...validForm, password: "play2026" }, validAllowlist).password).toBeUndefined();
    });
  });

  it("多字段同时非法：逐字段给出错误（字段名 → 中文提示）", () => {
    const errors = validateRegistrationForm(
      { studentId: "", realName: "", nickname: "", email: "x", password: "1" },
      validAllowlist,
    );
    expect(Object.keys(errors)).toEqual(["studentId", "realName", "nickname", "email", "password"]);
    // 每条提示都是非空中文文案
    for (const message of Object.values(errors)) expect(message!.length).toBeGreaterThan(0);
  });
});

describe("登录标识解析", () => {
  it("纯数字：判为学号", () => {
    expect(parseLoginIdentifier("2022110001")).toEqual({ type: "studentId", value: "2022110001" });
  });

  it("含 @：判为邮箱", () => {
    expect(parseLoginIdentifier("zhang@cuc.edu.cn")).toEqual({ type: "email", value: "zhang@cuc.edu.cn" });
  });

  it("字母数字学号格式：判为学号", () => {
    expect(parseLoginIdentifier("s2022110001")).toEqual({ type: "studentId", value: "s2022110001" });
  });

  it("首尾空白：去除后再判定", () => {
    expect(parseLoginIdentifier("  2022110001 \n")).toEqual({ type: "studentId", value: "2022110001" });
    expect(parseLoginIdentifier(" zhang@cuc.edu.cn ")).toEqual({ type: "email", value: "zhang@cuc.edu.cn" });
  });

  it("空输入：判为无效并给原因", () => {
    const result = parseLoginIdentifier("   ");
    expect(result.type).toBe("invalid");
    if (result.type === "invalid") expect(result.reason).toBeTruthy();
  });

  it("含非法字符且不含 @（如带空格/连字符）：判为无效", () => {
    expect(parseLoginIdentifier("2022 110").type).toBe("invalid");
    expect(parseLoginIdentifier("2022-110").type).toBe("invalid");
  });

  it("仅 @ 无域名：判为无效（不是合法邮箱）", () => {
    expect(parseLoginIdentifier("zhang@").type).toBe("invalid");
    expect(parseLoginIdentifier("@cuc.edu.cn").type).toBe("invalid");
  });

  it("超长学号格式（>20 位）：判为无效", () => {
    expect(parseLoginIdentifier("2".repeat(21)).type).toBe("invalid");
  });
});
