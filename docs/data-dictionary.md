# Data dictionary · 数据字典

本项目只生成教学用合成订单。没有姓名、手机号、IP、设备标识或真实交易数据。

## 原始 CSV

表头顺序为 `order_id,order_date,region,channel,status,amount_cents`。

| 字段 | 类型与规则 | 示例 |
|---|---|---|
| order_id | 1–80 字符、无首尾空格、全文件唯一 | `DEMO-0000001` |
| order_date | 合法 `YYYY-MM-DD`，按 UTC 日历处理，无时分秒 | `2026-01-01` |
| region | `east` / `central` / `west`，仅为模拟分组 | `east` |
| channel | `web` / `app` | `web` |
| status | `completed` / `refunded` / `cancelled`，每行一个最终状态 | `completed` |
| amount_cents | 0–100000000 的整数分，默认生成范围 900–99900 | `19900` |

输入金额上限是本教学导入器的校验规则，不是通用业务规则。示例没有货币兑换，也没有税费或优惠字段。

## 聚合 JSON v1

顶层包括 `schema_version=1`、`dataset_kind=synthetic_educational_demo`、`currency=CNY`、日期边界、`source_rows`、维度枚举和 `rows`。默认生成数据还包含种子与生成器标识；外部 CSV 标记为 `external_csv`。

每条聚合记录以 `(day, region, channel)` 唯一，包含 `total_orders`、`completed_orders`、`refunded_orders`、`cancelled_orders` 和 `revenue_cents`。

必须成立的约束：

```text
total_orders = completed_orders + refunded_orders + cancelled_orders
sum(rows.total_orders) = source_rows
revenue_cents = sum(amount_cents where status = 'completed')
```

没有记录的日期与分组可以不出现在 JSON 中；前端为选定日期区间补零。源数据中没有记录与真实业务发生零单并不是同一概念，本例因合成数据完整生成才可以把缺失组作为零值处理。

日度图按订单日期聚合；若未来接入真实事件，需要先定义业务时区、退款归属日期、迟到事件和去重策略，再修改契约版本及测试。
