import { describe, expect, it } from "vitest";
import { isEmailRegisterable } from "@/lib/email-allowlist";

// 边界穷举：开关（关闭=仅清单内可注册 / 打开=放开任意域名）× 域名（清单内 / 清单外）
const closedList = { allowAnyDomain: false, domainList: ["cuc.edu.cn"] };
const openList = { allowAnyDomain: true, domainList: ["cuc.edu.cn"] };

describe("邮箱白名单判定", () => {
  describe("开关关闭（仅清单内域名可注册）", () => {
    it("清单内域名：允许", () => {
      expect(isEmailRegisterable(closedList, "zhang@cuc.edu.cn")).toEqual({ allowed: true });
    });

    it("清单外域名：拦截", () => {
      expect(isEmailRegisterable(closedList, "zhang@gmail.com")).toEqual({
        allowed: false,
        reason: "邮箱域名不在白名单内",
      });
    });

    it("子域名不视同清单域名：拦截", () => {
      expect(isEmailRegisterable(closedList, "zhang@mail.cuc.edu.cn").allowed).toBe(false);
    });

    it("清单后缀字符串拼贴不算命中：拦截", () => {
      expect(isEmailRegisterable(closedList, "zhang@fakecuc.edu.cn").allowed).toBe(false);
      expect(isEmailRegisterable(closedList, "zhang@cuc.edu.cn.evil.com").allowed).toBe(false);
    });

    it("域名大小写不敏感：允许", () => {
      expect(isEmailRegisterable(closedList, "zhang@CUC.EDU.CN").allowed).toBe(true);
    });
  });

  describe("开关打开（放开任意域名）", () => {
    it("清单内域名：允许", () => {
      expect(isEmailRegisterable(openList, "zhang@cuc.edu.cn")).toEqual({ allowed: true });
    });

    it("清单外域名：也允许", () => {
      expect(isEmailRegisterable(openList, "zhang@gmail.com")).toEqual({ allowed: true });
    });
  });

  describe("非法邮箱输入", () => {
    it("无 @ 或多个 @：一律拦截（无论开关）", () => {
      for (const email of ["cuc.edu.cn", "a@b@cuc.edu.cn", ""]) {
        expect(isEmailRegisterable(closedList, email).allowed).toBe(false);
        expect(isEmailRegisterable(openList, email).allowed).toBe(false);
      }
    });

    it("无域名（@ 后为空）：拦截", () => {
      expect(isEmailRegisterable(closedList, "zhang@").allowed).toBe(false);
    });
  });

  describe("多域名清单", () => {
    const multiDomain = { allowAnyDomain: false, domainList: ["cuc.edu.cn", "bupt.edu.cn"] };

    it("清单内任一域名命中即允许，其余拦截", () => {
      expect(isEmailRegisterable(multiDomain, "a@cuc.edu.cn").allowed).toBe(true);
      expect(isEmailRegisterable(multiDomain, "a@bupt.edu.cn").allowed).toBe(true);
      expect(isEmailRegisterable(multiDomain, "a@pku.edu.cn").allowed).toBe(false);
    });
  });
});
