import { describe, expect, it } from "vitest";
import { 判定邮箱可注册 } from "@/lib/白名单";

// 边界穷举：开关（关闭=仅清单内可注册 / 打开=放开任意域名）× 域名（清单内 / 清单外）
const 关闭时清单 = { 放开任意域名: false, 域名清单: ["cuc.edu.cn"] };
const 打开时清单 = { 放开任意域名: true, 域名清单: ["cuc.edu.cn"] };

describe("邮箱白名单判定", () => {
  describe("开关关闭（仅清单内域名可注册）", () => {
    it("清单内域名：允许", () => {
      expect(判定邮箱可注册(关闭时清单, "zhang@cuc.edu.cn")).toEqual({ 允许: true });
    });

    it("清单外域名：拦截", () => {
      expect(判定邮箱可注册(关闭时清单, "zhang@gmail.com")).toEqual({
        允许: false,
        原因: "邮箱域名不在白名单内",
      });
    });

    it("子域名不视同清单域名：拦截", () => {
      expect(判定邮箱可注册(关闭时清单, "zhang@mail.cuc.edu.cn").允许).toBe(false);
    });

    it("清单后缀字符串拼贴不算命中：拦截", () => {
      expect(判定邮箱可注册(关闭时清单, "zhang@fakecuc.edu.cn").允许).toBe(false);
      expect(判定邮箱可注册(关闭时清单, "zhang@cuc.edu.cn.evil.com").允许).toBe(false);
    });

    it("域名大小写不敏感：允许", () => {
      expect(判定邮箱可注册(关闭时清单, "zhang@CUC.EDU.CN").允许).toBe(true);
    });
  });

  describe("开关打开（放开任意域名）", () => {
    it("清单内域名：允许", () => {
      expect(判定邮箱可注册(打开时清单, "zhang@cuc.edu.cn")).toEqual({ 允许: true });
    });

    it("清单外域名：也允许", () => {
      expect(判定邮箱可注册(打开时清单, "zhang@gmail.com")).toEqual({ 允许: true });
    });
  });

  describe("非法邮箱输入", () => {
    it("无 @ 或多个 @：一律拦截（无论开关）", () => {
      for (const 邮箱 of ["cuc.edu.cn", "a@b@cuc.edu.cn", ""]) {
        expect(判定邮箱可注册(关闭时清单, 邮箱).允许).toBe(false);
        expect(判定邮箱可注册(打开时清单, 邮箱).允许).toBe(false);
      }
    });

    it("无域名（@ 后为空）：拦截", () => {
      expect(判定邮箱可注册(关闭时清单, "zhang@").允许).toBe(false);
    });
  });

  describe("多域名清单", () => {
    const 多域名 = { 放开任意域名: false, 域名清单: ["cuc.edu.cn", "bupt.edu.cn"] };

    it("清单内任一域名命中即允许，其余拦截", () => {
      expect(判定邮箱可注册(多域名, "a@cuc.edu.cn").允许).toBe(true);
      expect(判定邮箱可注册(多域名, "a@bupt.edu.cn").允许).toBe(true);
      expect(判定邮箱可注册(多域名, "a@pku.edu.cn").允许).toBe(false);
    });
  });
});
