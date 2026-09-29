"""Generate synthetic orders, validate them, aggregate with SQLite, export a dashboard.

Run from the repository root: python -m src.pipeline
All monetary calculations use integer cents. No personal data is generated.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date, timedelta
import json
from pathlib import Path
import random
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ("order_id", "order_date", "region", "channel", "status", "amount_cents")
REGIONS = ("east", "central", "west")
CHANNELS = ("web", "app")
STATUSES = ("completed", "refunded", "cancelled")
START_DATE = date(2026, 1, 1)


def generate_orders(path: Path, count: int = 12000, seed: int = 42) -> None:
    if count <= 0:
        raise ValueError("count must be positive")
    rng = random.Random(seed)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(FIELDS)
        for number in range(count):
            writer.writerow((
                f"DEMO-{number + 1:07d}",
                (START_DATE + timedelta(days=rng.randrange(84))).isoformat(),
                rng.choices(REGIONS, weights=(5, 3, 2))[0],
                rng.choices(CHANNELS, weights=(4, 6))[0],
                rng.choices(STATUSES, weights=(88, 7, 5))[0],
                rng.randint(900, 99900),
            ))


def validate_order(row: dict[str, str], line: int) -> tuple:
    prefix = f"CSV line {line}: "
    if set(row) != set(FIELDS) or any(row[key] is None for key in FIELDS):
        raise ValueError(prefix + "wrong number of fields")
    order_id = row["order_id"]
    if not order_id or len(order_id) > 80 or order_id.strip() != order_id:
        raise ValueError(prefix + "invalid order_id")
    try:
        parsed = date.fromisoformat(row["order_date"])
    except (ValueError, TypeError) as error:
        raise ValueError(prefix + "invalid order_date") from error
    if parsed.isoformat() != row["order_date"]:
        raise ValueError(prefix + "order_date must be YYYY-MM-DD")
    for field, allowed in (("region", REGIONS), ("channel", CHANNELS), ("status", STATUSES)):
        if row[field] not in allowed:
            raise ValueError(prefix + f"unsupported {field}")
    value = row["amount_cents"]
    if not value.isascii() or not value.isdecimal() or int(value) > 100_000_000:
        raise ValueError(prefix + "amount_cents must be an integer from 0 to 100000000")
    return (order_id, parsed.isoformat(), row["region"], row["channel"], row["status"], int(value))


def ingest_orders(csv_path: Path, db_path: Path, chunk_size: int = 500) -> int:
    """Replace the dataset atomically: malformed rows roll back the entire import.

    Python holds at most chunk_size input rows. SQLite uses local disk for storage.
    Existing valid data survives a failed re-import.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("BEGIN")
        connection.execute("""CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            order_date TEXT NOT NULL,
            region TEXT NOT NULL,
            channel TEXT NOT NULL,
            status TEXT NOT NULL,
            amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)
        )""")
        connection.execute("DELETE FROM orders")
        total = 0
        pending = []
        with csv_path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != list(FIELDS):
                raise ValueError("CSV header must exactly match: " + ",".join(FIELDS))
            for line, row in enumerate(reader, start=2):
                pending.append(validate_order(row, line))
                if len(pending) == chunk_size:
                    connection.executemany("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)", pending)
                    total += len(pending)
                    pending.clear()
            if pending:
                connection.executemany("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)", pending)
                total += len(pending)
        if not total:
            raise ValueError("CSV must contain at least one order")
        connection.commit()
        return total
    except sqlite3.IntegrityError as error:
        connection.rollback()
        raise ValueError("Duplicate order_id or database constraint violation") from error
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def aggregate_orders(db_path: Path) -> dict:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = [dict(row) for row in connection.execute("""
            SELECT order_date AS day, region, channel,
                   COUNT(*) AS total_orders,
                   SUM(status = 'completed') AS completed_orders,
                   SUM(status = 'refunded') AS refunded_orders,
                   SUM(status = 'cancelled') AS cancelled_orders,
                   SUM(CASE WHEN status = 'completed' THEN amount_cents ELSE 0 END) AS revenue_cents
            FROM orders GROUP BY order_date, region, channel
            ORDER BY order_date, region, channel
        """)]
    finally:
        connection.close()
    if not rows:
        raise ValueError("Cannot export an empty dataset")
    return {
        "schema_version": 1,
        "dataset_kind": "synthetic_educational_demo",
        "currency": "CNY",
        "date_start": rows[0]["day"],
        "date_end": rows[-1]["day"],
        "source_rows": sum(row["total_orders"] for row in rows),
        "dimensions": {"regions": list(REGIONS), "channels": list(CHANNELS)},
        "rows": rows,
    }


def export_dashboard(data: dict, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    with (destination / "summary.json").open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(payload + "\n")
    # Classic script works on file://; the contents match the JSON contract exactly.
    with (destination / "summary.js").open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("window.DEMO_DATA = " + payload + ";\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=12000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--chunk-size", type=int, default=500)
    parser.add_argument("--input", type=Path, help="Optional CSV in the documented demo schema; skips generation")
    parser.add_argument("--database", type=Path, default=ROOT / "data" / "orders.sqlite")
    parser.add_argument("--output", type=Path, default=ROOT / "site" / "data")
    args = parser.parse_args()
    csv_path = args.input or ROOT / "data" / "orders.csv"
    if args.input is None:
        generate_orders(csv_path, count=args.rows, seed=args.seed)
    count = ingest_orders(csv_path, args.database, chunk_size=args.chunk_size)
    data = aggregate_orders(args.database)
    data["generation"] = {"seed": args.seed, "generator": "python_random_v1"} if args.input is None else {"generator": "external_csv"}
    export_dashboard(data, args.output)
    print(f"Validated {count:,} rows; exported {len(data['rows']):,} daily groups to {args.output}")


if __name__ == "__main__":
    main()
