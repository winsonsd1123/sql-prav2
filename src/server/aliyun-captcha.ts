// 阿里云验证码 2.0 服务端核验（VerifyIntelligentCaptcha，2023-03-05 版 API）。
// 凭据仅从环境变量读取；客户端单例，供登录服务注入/替换（测试接缝）。
import CaptchaClient, { VerifyIntelligentCaptchaRequest } from "@alicloud/captcha20230305";

const ENDPOINT = "captcha.cn-shanghai.aliyuncs.com";

type CaptchaClientType = InstanceType<typeof CaptchaClient>;
type CaptchaClientConfig = ConstructorParameters<typeof CaptchaClient>[0];

let singleton: CaptchaClientType | null = null;

function captchaClient(): CaptchaClientType {
  if (!singleton) {
    singleton = new CaptchaClient({
      accessKeyId: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_ID!,
      accessKeySecret: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_SECRET!,
      endpoint: ENDPOINT,
    } as CaptchaClientConfig);
  }
  return singleton;
}

/**
 * 核验前端透传的验证码票据。只认正常响应里的 VerifyResult；
 * 调用层异常（超时/5xx/DNS）一律拒绝登录——false 必拦截，异常交由上层 5xx（spec：无降级路径）。
 */
export async function verifyAliyunTicket(ticket: string): Promise<boolean> {
  const sceneCode = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_CODE;
  const response = await captchaClient().verifyIntelligentCaptcha(
    new VerifyIntelligentCaptchaRequest({
      captchaVerifyParam: ticket,
      // 场景码服务端写死，防情境被替换（笔记 4 要点）
      sceneId: sceneCode,
    }),
  );
  // 实测响应（2026-10 冒烟）：判定在 body.result.verifyResult（顶层另有一份同名旧字段，以 result 为准）
  return response.body?.result?.verifyResult === true;
}
