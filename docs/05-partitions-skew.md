# 05 · Spark / Hadoop：分区、倾斜与小文件

本仓库默认管线是单机 SQLite。`examples/spark_aggregate.py` 是同一数据契约的可选 PySpark 练习，当前仅完成语法核对，未执行 Spark 集群，不提供吞吐量或扩展性结论。

## 三种“分区”不要混淆

| 概念 | 影响什么 | 本例对应 |
|---|---|---|
| 输入分区 | 读取任务的并行度 | CSV 输入文件及可切分方式 |
| Shuffle 分区 | `groupBy` 后数据按键交换与计算的任务数 | `spark.sql.shuffle.partitions` |
| 目录分区 | 输出文件如何按业务列分目录存放 | `partitionBy('day')` 写 Parquet |

增加 Shuffle 分区不等于增加集群 CPU，也不保证更快；任务调度、网络和小任务开销可能变大。HDFS block 与 Spark partition 也不是严格一一对应，实际由文件格式、输入源与执行计划决定。

## 练习脚本的执行路径

脚本使用显式字符串 schema 读取 CSV，然后用 `try_cast` 解析金额与日期，保留无法解析的行作为 reject 输出。先验证枚举、日期格式、金额范围和重复 ID，再聚合完成订单金额。输出目录必须不存在，避免默认覆盖历史结果。

```bash
spark-submit examples/spark_aggregate.py \
  --input data/orders.csv \
  --output data/spark-output \
  --shuffle-partitions 8
```

适用 Spark 3.5+。这是运行建议而非本环境的实测记录。Spark 的日期解析与 schema 行为受版本和配置影响，应使用随脚本提供的校验逻辑并在目标环境核对输出计数。

## 数据倾斜先诊断，再处理

如果绝大多数记录属于某个区域，按区域分组可能使少量任务承担大量数据。首先看 Spark UI 中任务输入量、Shuffle read、耗时与 spill 的分布，再确定热点键。单看平均耗时容易掩盖拖尾任务。

常用措施包括：在交换前过滤或预聚合；对可合并聚合使用两阶段聚合；对确实足够小的维表考虑广播；在适当版本中评估 AQE。加盐会增加键与计算复杂度，而且平均值必须携带 sum/count，不能直接合并局部平均值。并不是所有倾斜都适合加盐。

## 按天写 Parquet 的局限

日期分区可以减少按日期查询时的扫描，但每天数据很少时会产生很多小文件。默认 12,000 条教学订单按 84 天分目录并不具有性能优势；这里展示的是布局语义。真实方案应根据写入量、查询谓词、压缩后文件大小和维护成本决定分区列。

不要为了得到一个文件在生产中无条件 `coalesce(1)`；这会将写入收缩为单任务。也不要用订单 ID 这类高基数字段直接建目录分区。

## 对照验证

在实际 Spark 环境运行后，应将分组键排序，并与 SQLite 的 `site/data/summary.json` 比较：键集合、订单计数、每种状态计数和整数金额应完全一致。只有结果一致后，性能对比才有意义。记录 Spark/JVM 版本、executor 资源、存储、数据量、分区数与冷/热缓存条件。

进一步阅读：[Spark — SQL Performance Tuning](https://spark.apache.org/docs/latest/sql-performance-tuning.html)、[Spark — CSV Files](https://spark.apache.org/docs/latest/sql-data-sources-csv.html)、[Hadoop — HDFS Architecture](https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html)。
