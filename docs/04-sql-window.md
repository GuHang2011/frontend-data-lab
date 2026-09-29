# 04 · SQL 聚合、指标分母与窗口函数

先确定“一行代表什么”，再写 SQL。本例的原始表是一行一笔订单，公开表是一行一个 `(日期, 区域, 渠道)` 分组。

## 条件聚合让口径可见

```sql
SELECT order_date, region, channel,
       COUNT(*) AS total_orders,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
       SUM(CASE WHEN status = 'completed' THEN amount_cents ELSE 0 END) AS revenue_cents
FROM orders
GROUP BY order_date, region, channel;
```

`COUNT(*)` 的分母包含全部状态。若先在 `WHERE` 中删除退款订单，再计算退款订单占比，就无法恢复正确分母。条件聚合保留了指标所需的总体。

平均订单金额不能再对分组平均值取简单平均。两个分组分别是 1 单/100 元与 9 单/180 元，则总体是 280/10=28 元，而不是 `(100+20)/2=60` 元。必须保存可相加的分子与分母，合并后再除。

## 最近七行不一定等于最近七天

窗口函数 `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` 的单位是行。若某一天没有记录，最近七行会跨越超过七个自然日。先补齐日期轴，才适合把“七行”解释为“七天”。

下面的 SQLite 查询可在本地生成的数据库上运行；它按完整日历计算七日完成金额总和与平均值：

```sql
WITH RECURSIVE
bounds AS (
  SELECT MIN(order_date) AS start_day, MAX(order_date) AS end_day FROM orders
),
calendar(day) AS (
  SELECT start_day FROM bounds WHERE start_day IS NOT NULL
  UNION ALL
  SELECT date(day, '+1 day') FROM calendar, bounds WHERE day < end_day
),
daily AS (
  SELECT order_date AS day,
         SUM(CASE WHEN status = 'completed' THEN amount_cents ELSE 0 END) AS cents
  FROM orders GROUP BY order_date
),
filled AS (
  SELECT calendar.day, COALESCE(daily.cents, 0) AS cents
  FROM calendar LEFT JOIN daily USING(day)
)
SELECT day, cents,
       SUM(cents) OVER (
         ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
       ) AS trailing_7d_cents,
       AVG(cents) OVER (
         ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
       ) AS trailing_available_day_average
FROM filled ORDER BY day;
```

前六天窗口不足七天，`AVG` 只平均已存在的日历天数，因此字段名写成 `available_day_average`。若业务要求固定七天分母，需要补齐观察期之前六天，或者明确把前六天显示为空；这属于口径选择，不能隐藏。

## 去重、排序与 NULL

本例用主键拒绝重复 ID。真实事件表通常允许同一订单有多次更新，需通过事件时间与稳定的并列排序键选出最终记录，例如 `ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY updated_at DESC, event_id DESC)`。仅有时间戳而无稳定排序键时，完全并列的事件可能导致结果不确定。

`COUNT(column)` 忽略 NULL，`COUNT(*)` 不忽略。不要在不理解缺失语义时使用 `COALESCE` 将所有空值变为零；本例的日历补零只对已定义的完整合成数据合理。

进一步阅读：[SQLite — Window Functions](https://www.sqlite.org/windowfunctions.html)、[SQLite — WITH](https://www.sqlite.org/lang_with.html)、[SQLite — Aggregate Functions](https://www.sqlite.org/lang_aggfunc.html)。
