# 判题内核：dt-sql-parser 校验 + 方言转译 + sql.js 执行 + MySQL 错误映射层

项目要求全部计算在浏览器端完成，且错误反馈与 MySQL 一致（错误码 + SQLSTATE + 文案三要素）。调研证实**不存在可用的浏览器端 MySQL 执行引擎**（npm/GitHub 均无产物），因此判题内核采用四层组合：`dt-sql-parser` 做 MySQL 方言语法校验（产出带行列位置的 1064 语法错误，附 1055 ONLY_FULL_GROUP_BY 静态检查）→ MySQL→SQLite 方言转译层（日期函数、CONCAT、GROUP_CONCAT SEPARATOR 等）→ `sql.js` 内存库执行（Web Worker 隔离）→ SQLite errmsg 到 MySQL 错误码的有限映射表。错误保真度的上限由此定为"高保真映射"（教学场景常见错误类别逐项对齐，冷门错误尽力映射），放弃全量逐字一致——后者只有后端真 MySQL 可达，与纯浏览器端约束冲突。

## Considered Options

- **后端真 MySQL（SQLZoo/LeetCode 模式）**：错误保真完美，但打破纯浏览器端/零后端/零边际成本约束，被否决。
- **DuckDB-wasm / PGLite**：数十 MB 体积且方言（PostgreSQL 系）离 MySQL 更远，被否决。
- **node-sql-parser 替代 dt-sql-parser**：社区更大、AST 更全，但已知部分内部错误无位置信息（issue #2041）、MySQL 语法覆盖有缺口；dt-sql-parser 提供结构化错误数组 + 行列位置 + 编辑器补全能力，更适合本项目。保留用真实 MySQL 错误样本回归夹具重新评估的选项。

## Consequences

- 方言差异是持续的维护面：学生写出 SQLite 接受而 MySQL 拒绝（或反之）的构造时，体验保真靠转译层和静态检查补位，需以错误映射回归测试集对冲。
- 解析器误报合法 MySQL 时，需维护例外白名单或容错降级。
