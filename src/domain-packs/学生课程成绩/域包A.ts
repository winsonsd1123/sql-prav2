import yaml from "./templates.yaml";
import { load } from "js-yaml";
import type { DomainPack, QuestionTemplate } from "@/kernel/types";

/**
 * 域包A：学生-课程-成绩。
 * 四层随机化（均由种子驱动）：
 * 1. 表名/列名：每语义角色配 2-3 候选池，实例化时按种子选定；
 * 2. 题目参数：阈值/关键词/排序方向随种子变化（templates.yaml 参数池）；
 * 3. 数据：中文业务值（人名/课程名/城市），每表 15-50 行；
 * 4. 刻意注入：NULL（空概率）、重复值（池小于行数）、空串、极端值（0/100 等）。
 */
export function 加载域包A(): DomainPack {
  const templates = load(yaml as unknown as string) as QuestionTemplate[];
  if (!Array.isArray(templates) || templates.length < 25 || templates.length > 35) {
    throw new Error("域包A应包含 25-35 个题目模板");
  }
  return {
    packId: "student-course-grade",
    name: "学生-课程-成绩",
    schemaSkeleton: [
      {
        tableRole: "学生",
        tableNamePool: ["学生", "学员", "同学"],
        serialKey: { columnRole: "学号", columnNamePool: ["学号", "学生编号"], startValue: 2024001 },
        rowCount: 20,
        columns: [
          {
            columnRole: "姓名",
            columnNamePool: ["姓名", "名字"],
            type: "TEXT",
            valuePool: ["张伟", "李娜", "王强", "刘洋", "陈静", "赵敏", "孙磊", "周雪", "吴昊", "郑爽", "何平", "林芳", "徐刚", "朱丽", "高翔", "黄蓉", "罗成", "谢婷", "唐军", "曹颖", "冯远", "邓佳", "彭飞", "吕燕"],
          },
          { columnRole: "性别", type: "TEXT", valuePool: ["男", "女"] },
          {
            columnRole: "城市",
            columnNamePool: ["城市", "生源地"],
            type: "TEXT",
            // 空串入池 + 空概率：为 DISTINCT / 空串边界提供素材
            valuePool: ["北京", "上海", "广州", "深圳", ""],
            nullProbability: 0.1,
          },
          {
            columnRole: "奖学金",
            columnNamePool: ["奖学金", "奖励金额"],
            type: "INTEGER",
            valuePool: [0, 1500, 3000, 5000, 8000, 10000],
          },
          {
            columnRole: "出生日期",
            columnNamePool: ["出生日期", "生日"],
            type: "TEXT",
            // 'YYYY-MM-DD' 中文业务语料；含闰日 2004-02-29 等边界值；小空概率提供日期 NULL 素材
            valuePool: ["2002-12-25", "2003-01-15", "2003-06-08", "2003-08-17", "2004-02-29", "2004-04-02", "2004-09-01", "2005-03-12", "2005-11-20", "2006-05-30"],
            nullProbability: 0.05,
          },
        ],
      },
      {
        tableRole: "课程",
        tableNamePool: ["课程", "科目"],
        serialKey: { columnRole: "课程号", columnNamePool: ["课程号", "课程编号"], startValue: 101 },
        rowCount: 15,
        columns: [
          {
            columnRole: "课程名",
            columnNamePool: ["课程名", "课程名称"],
            type: "TEXT",
            // 池小于行数 → 刻意制造重复课程名，为 DISTINCT 类题目提供非平凡素材
            valuePool: ["高等数学", "数据结构", "操作系统", "数据库原理", "计算机网络", "大学英语", "线性代数", "软件工程", "概率论", "大学物理", "离散数学", "编译原理"],
          },
          { columnRole: "学分", type: "INTEGER", valuePool: [2, 3, 4] },
          {
            columnRole: "教师",
            columnNamePool: ["教师", "任课教师"],
            type: "TEXT",
            valuePool: ["王老师", "李老师", "张老师", "刘老师", ""],
            nullProbability: 0.05,
          },
        ],
      },
      {
        tableRole: "成绩",
        tableNamePool: ["成绩", "考试记录"],
        rowCount: 45,
        columns: [
          { columnRole: "学号", type: "INTEGER", valuePool: [], reference: { table: "学生", column: "学号" } },
          { columnRole: "课程号", type: "INTEGER", valuePool: [], reference: { table: "课程", column: "课程号" } },
          {
            columnRole: "分数",
            columnNamePool: ["分数", "得分"],
            type: "INTEGER",
            // 0/100 为刻意注入的极端值；空概率注入 NULL，为 IS NULL 类题目提供素材
            valuePool: [0, 55, 60, 62, 65, 68, 70, 72, 75, 78, 80, 82, 85, 88, 90, 92, 95, 100],
            nullProbability: 0.15,
          },
          {
            columnRole: "考试日期",
            columnNamePool: ["考试日期", "考试时间"],
            type: "TEXT",
            // 跨学期分布，含 2024 闰日与年初/年末边界，为日期函数题（T4 转译层）提供素材
            valuePool: ["2024-02-29", "2025-03-10", "2025-04-15", "2025-05-20", "2025-06-25", "2025-09-08", "2025-10-12", "2025-11-03", "2026-01-09", "2026-03-15"],
          },
        ],
      },
    ],
    templates,
  };
}
