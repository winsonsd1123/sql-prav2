import yaml from "./templates.yaml";
import { load } from "js-yaml";
import type { DomainPack, QuestionTemplate } from "@/kernel/types";

/**
 * 域包B：员工-部门-薪资（T7，issue #8，与域包A 同标准）。
 * 四层随机化（均由种子驱动）：
 * 1. 表名/列名：每语义角色配 2-3 候选池，实例化时按种子选定；
 * 2. 题目参数：阈值/关键词/排序方向随种子变化（templates.yaml 参数池）；
 * 3. 数据：中文业务值（人名/职位/城市），每表 12-45 行；
 * 4. 刻意注入：NULL（空概率）、重复值（池小于行数）、空串、极端值（0 元发放等）。
 * 日期题只用固定日期列（入职日期/发放日期），规避 NOW/CURDATE 的跨执行抖动。
 */
export function loadPackB(): DomainPack {
  const templates = load(yaml as unknown as string) as QuestionTemplate[];
  if (!Array.isArray(templates) || templates.length < 25 || templates.length > 35) {
    throw new Error("域包B应包含 25-35 个题目模板");
  }
  return {
    packId: "employee-department-payroll",
    name: "员工-部门-薪资",
    schemaSkeleton: [
      {
        tableRole: "部门",
        tableNamePool: ["部门", "部门表"],
        serialKey: { columnRole: "部门号", columnNamePool: ["部门号", "部门编号"], startValue: 10 },
        rowCount: 12,
        columns: [
          {
            columnRole: "部门名",
            columnNamePool: ["部门名", "部门名称"],
            type: "TEXT",
            // 池小于行数 → 刻意制造重名部门，为 GROUP BY 部门号+部门名 的模板提供非平凡素材
            valuePool: ["技术部", "产品部", "市场部", "财务部", "人事部", "运营部"],
          },
          {
            columnRole: "城市",
            columnNamePool: ["城市", "所在地"],
            type: "TEXT",
            // 空串入池 + 空概率：为 IS NOT NULL 类题目提供素材
            valuePool: ["北京", "上海", "深圳", "杭州", ""],
            nullProbability: 0.1,
          },
          {
            columnRole: "预算",
            columnNamePool: ["预算", "年度预算"],
            type: "INTEGER",
            valuePool: [500000, 800000, 1200000, 2000000],
          },
        ],
      },
      {
        tableRole: "员工",
        tableNamePool: ["员工", "职员"],
        serialKey: { columnRole: "员工号", columnNamePool: ["员工号", "员工编号"], startValue: 1001 },
        rowCount: 22,
        columns: [
          {
            columnRole: "姓名",
            columnNamePool: ["姓名", "名字"],
            type: "TEXT",
            valuePool: ["王磊", "李静", "张勇", "刘婷", "陈飞", "杨帆", "赵雪", "黄海", "周颖", "吴斌", "徐丽", "孙强", "马超", "朱琳", "胡军", "郭燕", "何鑫", "高远", "林悦", "罗涛", "郑爽", "梁晨", "宋佳", "唐磊"],
          },
          { columnRole: "性别", type: "TEXT", valuePool: ["男", "女"] },
          {
            columnRole: "职位",
            columnNamePool: ["职位", "岗位"],
            type: "TEXT",
            // 空串入池 + 空概率：为 DISTINCT + IS NOT NULL 类题目提供素材
            valuePool: ["工程师", "经理", "分析师", "设计师", "主管", ""],
            nullProbability: 0.1,
          },
          { columnRole: "部门号", type: "INTEGER", valuePool: [], reference: { table: "部门", column: "部门号" } },
          {
            columnRole: "月薪",
            columnNamePool: ["月薪", "月薪资"],
            type: "INTEGER",
            // 空概率注入 NULL（待定薪员工），为 IS NULL / MAX 忽略空值类题目提供素材
            valuePool: [4500, 6000, 8000, 10000, 12000, 15000, 20000, 30000],
            nullProbability: 0.1,
          },
          {
            columnRole: "入职日期",
            columnNamePool: ["入职日期", "入职时间"],
            type: "TEXT",
            // 'YYYY-MM-DD' 中文业务语料；含闰日 2020-02-29 等边界值；跨多个年份供 YEAR 分组
            valuePool: ["2019-07-01", "2020-02-29", "2021-03-15", "2021-11-08", "2022-06-20", "2023-01-09", "2023-09-12", "2024-04-03", "2024-10-28", "2025-02-17", "2025-08-05"],
          },
        ],
      },
      {
        tableRole: "薪资发放",
        tableNamePool: ["薪资发放", "工资发放"],
        serialKey: { columnRole: "发放序号", columnNamePool: ["发放序号", "发放编号"], startValue: 1 },
        rowCount: 45,
        columns: [
          { columnRole: "员工号", type: "INTEGER", valuePool: [], reference: { table: "员工", column: "员工号" } },
          {
            columnRole: "发放金额",
            columnNamePool: ["发放金额", "实发金额"],
            type: "INTEGER",
            // 0 为刻意注入的极端值（未发薪记录）；空概率注入 NULL，为 IS NULL 类题目提供素材
            valuePool: [0, 4500, 6000, 8000, 10000, 12000, 15000, 18000, 20000, 25000, 30000],
            nullProbability: 0.15,
          },
          {
            columnRole: "发放日期",
            columnNamePool: ["发放日期", "发放时间"],
            type: "TEXT",
            // 跨年度分布，含 2024 闰日与年初/年末边界，为日期函数题（T4 转译层）提供素材
            valuePool: ["2024-02-29", "2025-01-15", "2025-04-10", "2025-06-30", "2025-09-08", "2025-12-20", "2026-01-09", "2026-03-15"],
          },
          {
            columnRole: "绩效等级",
            columnNamePool: ["绩效等级", "绩效"],
            type: "TEXT",
            valuePool: ["A", "B", "C"],
            nullProbability: 0.1,
          },
        ],
      },
    ],
    templates,
  };
}
