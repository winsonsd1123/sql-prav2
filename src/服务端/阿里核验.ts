// 阿里云验证码 2.0 服务端核验（VerifyIntelligentCaptcha，2023-03-05 版 API）。
// 凭据仅从环境变量读取；客户端单例，供登录服务注入/替换（测试接缝）。
import 客户端, { VerifyIntelligentCaptchaRequest } from "@alicloud/captcha20230305";

const 端点 = "captcha.cn-shanghai.aliyuncs.com";

type 核验客户端类型 = InstanceType<typeof 客户端>;
type 客户端配置 = ConstructorParameters<typeof 客户端>[0];

let 单例: 核验客户端类型 | null = null;

function 核验客户端(): 核验客户端类型 {
  if (!单例) {
    单例 = new 客户端({
      accessKeyId: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_ID!,
      accessKeySecret: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_SECRET!,
      endpoint: 端点,
    } as 客户端配置);
  }
  return 单例;
}

/**
 * 核验前端透传的验证码票据。只认正常响应里的 VerifyResult；
 * 调用层异常（超时/5xx/DNS）按官方容灾建议放行——false 必拦截，异常交由上层 5xx。
 */
export async function 核验阿里票据(票据: string): Promise<boolean> {
  const 场景码 = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_CODE;
  const 响应 = await 核验客户端().verifyIntelligentCaptcha(
    new VerifyIntelligentCaptchaRequest({
      captchaVerifyParam: 票据,
      // 场景码服务端写死，防情境被替换（笔记 4 要点）
      sceneId: 场景码,
    }),
  );
  // 实测响应（2026-10 冒烟）：判定在 body.result.verifyResult（顶层另有一份同名旧字段，以 result 为准）
  return 响应.body?.result?.verifyResult === true;
}
