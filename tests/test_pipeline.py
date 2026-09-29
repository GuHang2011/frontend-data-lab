import csv
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from src.pipeline import FIELDS, aggregate_orders, export_dashboard, generate_orders, ingest_orders


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.csv = self.root / "orders.csv"
        self.db = self.root / "orders.sqlite"

    def tearDown(self):
        self.temp.cleanup()

    def write_rows(self, rows):
        with self.csv.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(FIELDS)
            writer.writerows(rows)

    def test_integer_metrics_and_status_denominators(self):
        self.write_rows([
            ("1", "2026-01-01", "east", "web", "completed", 1001),
            ("2", "2026-01-01", "east", "web", "completed", 2002),
            ("3", "2026-01-01", "east", "web", "refunded", 9999),
            ("4", "2026-01-01", "east", "web", "cancelled", 500),
        ])
        self.assertEqual(ingest_orders(self.csv, self.db, 2), 4)
        row = aggregate_orders(self.db)["rows"][0]
        self.assertEqual(row["revenue_cents"], 3003)
        self.assertEqual((row["total_orders"], row["completed_orders"], row["refunded_orders"], row["cancelled_orders"]), (4, 2, 1, 1))

    def test_chunk_size_does_not_change_output(self):
        generate_orders(self.csv, 137, seed=17)
        results = []
        for chunk_size in (1, 7, 500):
            ingest_orders(self.csv, self.db, chunk_size)
            results.append(aggregate_orders(self.db))
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[1], results[2])

    def test_seed_reproducibility(self):
        generate_orders(self.csv, 50, seed=42)
        first = self.csv.read_bytes()
        generate_orders(self.csv, 50, seed=42)
        self.assertEqual(first, self.csv.read_bytes())

    def test_invalid_values_and_duplicate_ids_roll_back(self):
        valid = ["1", "2026-01-01", "east", "web", "completed", 100]
        self.write_rows([valid])
        ingest_orders(self.csv, self.db)
        before = aggregate_orders(self.db)
        for position, value in ((1, "2026-02-30"), (1, "20260101"), (2, "unknown"), (4, "pending"), (5, "-1"), (5, "1.2"), (5, "100000001")):
            invalid = valid.copy()
            invalid[position] = value
            with self.subTest(position=position, value=value):
                self.write_rows([["2", *valid[1:]], invalid])
                with self.assertRaises(ValueError):
                    ingest_orders(self.csv, self.db, chunk_size=1)
                self.assertEqual(before, aggregate_orders(self.db))
        self.write_rows([valid, valid])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            ingest_orders(self.csv, self.db, chunk_size=1)
        self.assertEqual(before, aggregate_orders(self.db))

    def test_empty_bad_header_and_invalid_chunk(self):
        self.write_rows([])
        with self.assertRaises(ValueError):
            ingest_orders(self.csv, self.db)
        self.csv.write_text("wrong,header\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "header"):
            ingest_orders(self.csv, self.db)
        with self.assertRaisesRegex(ValueError, "chunk_size"):
            ingest_orders(self.csv, self.db, 0)

    def test_offline_bundle_matches_json(self):
        generate_orders(self.csv, 25)
        ingest_orders(self.csv, self.db)
        payload = aggregate_orders(self.db)
        export_dashboard(payload, self.root / "export")
        json_data = json.loads((self.root / "export/summary.json").read_text(encoding="utf-8"))
        bundle = (self.root / "export/summary.js").read_text(encoding="utf-8")
        self.assertTrue(bundle.startswith("window.DEMO_DATA = ") and bundle.endswith(";\n"))
        bundled_data = json.loads(bundle[len("window.DEMO_DATA = "):-2])
        self.assertEqual(json_data, bundled_data)
        self.assertEqual(json_data["source_rows"], 25)


if __name__ == "__main__":
    unittest.main()
