# Frontend × Data Lab

**A reproducible learning project connecting frontend interfaces, SQL analytics, and data quality.**  
从数据记录到交互界面：顾航的前端与数据分析学习作品。

[打开演示页面](https://guhang2011.github.io/frontend-data-lab/) · [审阅入口](REVIEWER_ENTRY.md) · [数据字典](docs/data-dictionary.md) · [学习笔记](docs/README.md) · [代码示例](examples/README.md)

> 使用固定种子的合成订单数据，展示可复现数据处理与前端交互设计的教学项目。

本仓库同时收录数据标注质量检查、公开网页采集、模型基础与笔试复习材料。它们是学习练习；模型笔记不代表已经完成模型训练或取得科研结果。

## Start here

直接打开 `site/index.html` 即可离线使用。仓库已包含合成数据的聚合快照，不需要安装依赖或启动服务；根目录 `index.html` 会跳转到演示页。

重新生成数据（Python 3.8+）：

```bash
python -m src.pipeline
python -m unittest discover -s tests -p "test_*.py" -v
node --test tests/dashboard.test.cjs
node --test demos/form/form-core.test.cjs
python examples/data-labeling/label_quality.py
```

Node.js 18+ 仅用于运行前端逻辑测试，页面本身不依赖 Node。也可在根目录运行 `python -m http.server 8000`，浏览 `http://localhost:8000/site/`。关闭服务用 Ctrl+C。

这些命令均在仓库根目录运行。2026-10-08 发布前验证环境为 Python 3.8.6、Node.js 25.2.1；Python 示例仅用标准库。爬虫测试使用模拟响应，无需网络访问。

## Frontend

页面使用原生 JavaScript、HTML、CSS，无外部 CDN、字体或图表依赖。浅纸色、深蓝导航和翠绿图表构成统一视觉语言。

- 区域、渠道与日期范围可以组合筛选，筛选后重算分母、平均值和占比。
- SVG 趋势图、区域金额构成、逐日明细和 CSV 下载共享同一份筛选结果。
- 缺失日期补零；零分母显示 `—`；错误日期会说明原因并保留上一次有效结果。
- 提供表单标签、键盘焦点、跳转链接、更新状态播报和与图表对应的数据表。
- `summary.js` 与 `summary.json` 来自同一次导出，前者兼容离线打开，后者提供可检查的数据契约。

前端入口：[site/index.html](site/index.html) · [展示逻辑](site/dashboard.js) · [样式](site/styles.css) · [多步骤表单练习](demos/form/index.html)

## Data pipeline

```text
固定种子生成 CSV → 校验与分块读取 → SQLite 事务导入
                                    ↓
                      日期 × 区域 × 渠道 SQL 聚合
                                    ↓
                      公开 JSON + 离线 JavaScript 快照
                                    ↓
                      筛选、图表、指标、明细与 CSV
```

默认参数为 `--rows 12000 --seed 42 --chunk-size 500`，日期为 2026-01-01 至 2026-03-25，共 84 天。区域概率为 5:3:2，渠道为 4:6，状态为 88:7:5；因此图中的构成变化是生成规则与随机采样的结果。

```bash
python -m src.pipeline --rows 24000 --seed 17 --chunk-size 1000
python -m src.pipeline --input data/my-synthetic-orders.csv
```

`--input` 仅用于符合本项目字段定义的教学 CSV。页面保持“合成数据”标记；不要把真实业务数据直接放入公开仓库。导入要求表头顺序严格匹配，日期合法，枚举值已知，订单 ID 唯一，金额为非负整数分。任何非法记录都会使本次导入整体回滚，已存在的有效数据保留。

| 指标 | 定义 |
|---|---|
| 全部订单 | 完成、退款、取消三种最终状态的订单数 |
| 完成订单金额 | `status = completed` 的金额之和；不等同于会计收入 |
| 平均订单金额 | 完成订单金额 / 完成订单数；分母为零时无定义 |
| 退款订单占比 | 退款订单数 / 全部订单数；不称为退款金额率 |

金额用整数分累计，仅在展示时换算为元。每笔订单只有一个最终状态，没有退款流水、支付时间或重复事件；本例不处理真实订单生命周期和事件时间水位线。

可选分布式练习见 [examples/spark_aggregate.py](examples/spark_aggregate.py)。它用显式 schema 读取同一 CSV、分开有效和无效记录、聚合并按日期写 Parquet。**该脚本只进行了语法核对，未在本环境运行 PySpark 或 Spark 集群**；安装 Spark 与集群调优不在默认依赖内。

```bash
# 仅在已经配置 PySpark 的环境中使用；输出目录必须不存在
spark-submit examples/spark_aggregate.py --input data/orders.csv --output data/spark-output --shuffle-partitions 8
```

## Notes

围绕本仓库代码组织的配套学习笔记。完整阅读路线见 [笔记总览](docs/README.md) 与 [模型知识地图](docs/modeling-reading-map.md)。

| 主题 | 阅读内容 |
|---|---|
| [01 · 前端状态与表单](docs/01-frontend-state.md) | 原始状态、派生状态、即时筛选、校验与重置 |
| [02 · 接口契约与错误态](docs/02-contracts-errors.md) | 数据版本、运行时校验、空态、失败语义 |
| [03 · 性能与无障碍](docs/03-performance-accessibility.md) | 渲染成本、图表替代、键盘与测量方法 |
| [04 · SQL 与窗口函数](docs/04-sql-window.md) | 聚合粒度、加权指标、完整日期轴与滚动窗口 |
| [05 · Spark / Hadoop 分区与倾斜](docs/05-partitions-skew.md) | 输入分区、Shuffle、输出分区、小文件与热点键 |
| [06 · 数据质量与可复现性](docs/06-data-quality-reproducibility.md) | 约束、事务、种子、环境记录与诚实评估 |
| [07 · 辅导员工作流](docs/07-counselor-workflow.md) | 从业务状态、权限边界到研究问题 |
| [08 · 前端性能实践](docs/08-frontend-performance.md) | 数据表、交互反馈与性能测量 |
| [09 · 建模基础](docs/09-modeling-basics.md) | 任务定义、基线、时间与分组切分 |
| [10 · 特征工程](docs/10-feature-engineering.md) | 编码、历史窗口与数据泄漏 |
| [11 · 评估与误差分析](docs/11-evaluation-error-analysis.md) | 指标选择、分层评估与失败案例 |
| [12 · 模型笔试与面试](docs/12-model-interview-notes.md) | 正则化、树模型、过拟合与阈值 |

## Applied examples

| 练习 | 可运行内容 | 证据与限制 |
| --- | --- | --- |
| [数据标注质量](examples/data-labeling/) | 读取 5 条合成请求，检查双人一致率、覆盖率和复核队列 | 缺失标注单列，未知标签报错；样本不是标注质量实验 |
| [公开网页采集](examples/public-crawler/) | robots 检查、同源限制、限速、请求预算与 JSONL 输出 | 拒绝自动重定向；已做离线边界测试，未做真实站点联网测试 |
| [表单状态机](demos/form/) | [在线表单](https://guhang2011.github.io/frontend-data-lab/demos/form/)：多步校验、草稿恢复和条件字段 | 使用本地演示状态，不提交真实申请 |

相关工程案例：[辅导员工作流在线展示](https://guhang2011.github.io/counselor-workflow-showcase/) · [案例代码](https://github.com/GuHang2011/counselor-workflow-showcase)。

从 [实验卡片模板](docs/experiment-card-template.md) 开始记录问题、数据版本、方法、指标和局限性。模板本身不是实验结果。

## Repository map

```text
src/pipeline.py            标准库 CSV → SQLite → JSON 管线
site/index.html            离线可用的交互观察台
site/dashboard.js          筛选、聚合、可视化与导出
site/data/summary.json     可检查的公开合成聚合数据
site/data/summary.js       同一份数据的离线脚本封装
examples/spark_aggregate.py 可选的 PySpark 练习
examples/data-labeling/    合成文本标签、完整性与一致率检查
examples/public-crawler/   有请求边界的公开页面元数据采集
demos/form/               多步骤表单、草稿恢复与状态机练习
docs/                     数据字典、12 篇学习笔记与模型阅读路线
tests/                    管线、标注、爬虫与前端逻辑验证
data/                     本地生成 CSV / SQLite（不提交）
```

## Validation and limits

Python 测试覆盖分块大小不变性、种子复现、整数金额与状态指标、非法输入、重复 ID 的事务回滚、空输入和 JSON/离线快照一致性。Node 测试覆盖筛选组合、加权分母、零分母、缺失日期、单日范围、CSV 和已提交数据契约。

新增离线测试覆盖缺失标注的分母、未知标签、重复任务 ID、robots 拒绝与不可用、重定向阻断、同源检查、去重、请求预算、非 HTML/失败请求限速、响应体积和非法参数。测试结果与尚未执行的 Spark、真实站点联网验证分别说明，避免把代码存在当作实验完成。

已在浏览器检查桌面页面、组合筛选、反向日期错误与重置恢复。读屏器实测、生产并发和分布式吞吐量不属于已完成验证。

这是单机教学规模示例，分块导入只限制 Python 的输入缓冲量，不表示整个程序内存恒定：导出和浏览器仍会把全部聚合分组读入内存。页面适合几百至几千个分组；更大规模应先在服务端聚合、分页或降采样。
