// 注册服务（服务端）：注册预检 = 表单校验（含白名单双保险）+ 学号唯一。
// 业务逻辑集中于此，Route Handler 只做协议层（ADR-0004 的组织纪律）。
import { 服务端特权客户端 } from "@/lib/supabase/服务端客户端";
import { 校验注册表单, type 注册表单, type 注册表单错误 } from "@/lib/注册校验";
import { 读白名单配置 } from "@/服务端/白名单服务";

export interface 注册预检结果 {
  可注册: boolean;
  错误: 注册表单错误;
}

/** 学号是否已被注册（服务端特权身份直查用户档案；表级唯一约束为最终兜底） */
async function 学号已占用(学号: string): Promise<boolean> {
  const 客户端 = 服务端特权客户端();
  const { data } = await 客户端.from("用户档案").select("id").eq("学号", 学号).maybeSingle();
  return data !== null;
}

export async function 注册预检(表单: 注册表单): Promise<注册预检结果> {
  const 白名单 = await 读白名单配置();
  const 错误 = 校验注册表单(表单, 白名单);
  if (!错误.学号) {
    // 学号格式合法才查库，避免无谓请求；查库异常视为未占用，交由表级唯一约束兜底
    try {
      if (await 学号已占用(表单.学号.trim())) 错误.学号 = "该学号已注册";
    } catch {
      /* 交由唯一约束兜底 */
    }
  }
  return { 可注册: Object.keys(错误).length === 0, 错误 };
}
