// 部署环境回归（用户验收报错）：服务端（教师端生成/发布等闸门路径）在 Node 里初始化 sql.js，
// 空配置走 sql.js 默认 __dirname 定位——本地 node_modules 完整所以 Vitest 全绿，
// 但 serverless 打包不带 node_modules/sql.js/dist/sql-wasm.wasm 二进制（nft 追踪只有 JS chunk），
// 部署环境 ENOENT。回归锚点：Node 端定位必须指向随部署恒定分发的 public 副本，不依赖 node_modules 布局。
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveNodeSqlWasmPath } from "@/kernel/execute";

describe("Node 端 sql.js wasm 定位", () => {
  it("指向 public/sql-wasm.wasm（随部署分发的副本），且文件真实存在、内容为 wasm", () => {
    const p = resolveNodeSqlWasmPath();
    expect(p).toContain("public/sql-wasm.wasm");
    expect(existsSync(p)).toBe(true);
    // wasm 魔数 \0asm
    const magic = readFileSync(p).subarray(0, 4);
    expect([...magic]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });
});
