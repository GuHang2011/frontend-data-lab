"""Optional PySpark 3.5+ exercise; not executed on a Spark cluster for this repo.

Uses the same synthetic CSV as src.pipeline. Invalid rows and every occurrence
of duplicated IDs are written to rejects; valid rows are aggregated to Parquet.
Unlike the strict SQLite importer, this exercise keeps a quarantine dataset.
Output is not atomic across its two subdirectories; use a fresh output path.
"""
import argparse
import json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Synthetic orders CSV path")
    parser.add_argument("--output", required=True, help="New output directory")
    parser.add_argument("--shuffle-partitions", type=int, default=8)
    args = parser.parse_args()
    if args.shuffle_partitions <= 0:
        parser.error("--shuffle-partitions must be positive")

    from pyspark.sql import SparkSession, functions as F, types as T

    spark = (SparkSession.builder.appName("SyntheticFrontendDataLab")
             .config("spark.sql.shuffle.partitions", str(args.shuffle_partitions))
             .config("spark.sql.session.timeZone", "UTC").getOrCreate())
    try:
        # Read every input field as text first so malformed values can be identified.
        fields = ["order_id", "order_date", "region", "channel", "status", "amount_cents"]
        schema = T.StructType([T.StructField(name, T.StringType(), True) for name in fields])
        raw = (spark.read.option("header", True).option("mode", "FAILFAST")
               .option("enforceSchema", False).schema(schema).csv(args.input))
        parsed = (raw.withColumn("parsed_day", F.expr("try_cast(order_date AS DATE)"))
                  .withColumn("parsed_cents", F.expr("try_cast(amount_cents AS BIGINT)")))
        valid = (
            (F.length("order_id").between(1, 80)) &
            (F.col("order_id") == F.trim("order_id")) &
            F.col("order_date").rlike(r"^\d{4}-\d{2}-\d{2}$") &
            (F.date_format("parsed_day", "yyyy-MM-dd") == F.col("order_date")) &
            F.col("region").isin("east", "central", "west") &
            F.col("channel").isin("web", "app") &
            F.col("status").isin("completed", "refunded", "cancelled") &
            F.col("amount_cents").rlike(r"^[0-9]+$") &
            F.col("parsed_cents").between(0, 100_000_000)
        )
        checked = parsed.withColumn("is_valid", F.coalesce(valid, F.lit(False))).cache()
        duplicates = (checked.groupBy("order_id").count().filter(F.col("count") > 1)
                      .select("order_id").withColumn("duplicate_id", F.lit(True)))
        classified = checked.join(duplicates, "order_id", "left").withColumn(
            "reject_reason", F.when(~F.col("is_valid"), F.lit("invalid_field"))
            .when(F.col("duplicate_id"), F.lit("duplicate_order_id")))
        accepted = classified.filter(F.col("reject_reason").isNull())
        rejected = classified.filter(F.col("reject_reason").isNotNull())
        input_count = checked.count()
        if input_count == 0:
            raise ValueError("Input contains no orders")
        rejected_count = rejected.count()

        # Check the parent once; subdirectory writes also refuse overwrite.
        output_path = spark._jvm.org.apache.hadoop.fs.Path(args.output)
        filesystem = output_path.getFileSystem(spark._jsc.hadoopConfiguration())
        if filesystem.exists(output_path):
            raise FileExistsError("Output directory already exists; choose a new path")

        completed = F.col("status") == "completed"
        grouped = accepted.groupBy(F.col("order_date").alias("day"), "region", "channel").agg(
            F.count("*").alias("total_orders"),
            F.sum(F.when(completed, 1).otherwise(0)).alias("completed_orders"),
            F.sum(F.when(F.col("status") == "refunded", 1).otherwise(0)).alias("refunded_orders"),
            F.sum(F.when(F.col("status") == "cancelled", 1).otherwise(0)).alias("cancelled_orders"),
            F.sum(F.when(completed, F.col("parsed_cents")).otherwise(0)).alias("revenue_cents"),
        )
        rejected.select(*fields, "reject_reason").write.mode("errorifexists").parquet(args.output + "/rejects")
        grouped.write.mode("errorifexists").partitionBy("day").parquet(args.output + "/daily")
        print(json.dumps({"dataset_kind": "synthetic_educational_demo", "input_rows": input_count,
                          "accepted_rows": input_count - rejected_count, "rejected_rows": rejected_count,
                          "shuffle_partitions": args.shuffle_partitions, "output": args.output}))
        checked.unpersist()
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
