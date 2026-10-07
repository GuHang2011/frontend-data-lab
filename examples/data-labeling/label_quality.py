"""Validate and summarise a synthetic, two-annotator classification exercise."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

LABELS = {"academic", "campus_services", "wellbeing_support", "other"}
ANNOTATORS = {"ann-a", "ann-b"}


def load_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def summarise(rows: list[dict]) -> dict:
    """Only items with both expected annotators enter the agreement denominator."""
    agreements = 0
    complete = 0
    ids: set[str] = set()
    label_counts: Counter[str] = Counter()
    conflicts: list[dict] = []
    by_annotator: dict[str, Counter[str]] = defaultdict(Counter)

    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"].strip():
            raise ValueError("Every item needs a nonempty string id")
        if row["id"] in ids:
            raise ValueError("Duplicate item id: " + row["id"])
        ids.add(row["id"])
        if not isinstance(row.get("text"), str) or not row["text"].strip():
            raise ValueError("Every item needs nonempty text")
        labels = row.get("labels", {})
        if not isinstance(labels, dict) or not set(labels).issubset(ANNOTATORS):
            raise ValueError("labels must map ann-a and/or ann-b to labels")
        if any(not isinstance(label, str) or label not in LABELS for label in labels.values()):
            raise ValueError("Unknown label; consult the label guide")
        for annotator, label in labels.items():
            by_annotator[annotator][label] += 1
        if set(labels) != ANNOTATORS:
            conflicts.append({"id": row["id"], "reason": "incomplete", "labels": labels})
            continue
        complete += 1
        unique = set(labels.values())
        if len(unique) == 1:
            agreements += 1
            label = next(iter(unique))
            label_counts[label] += 1
        else:
            conflicts.append({"id": row["id"], "reason": "disagreement", "labels": labels})

    return {
        "items": len(rows),
        "complete_items": complete,
        "incomplete_items": len(rows) - complete,
        "agreed_items": agreements,
        "agreement_rate": agreements / complete if complete else None,
        "coverage": complete / len(rows) if rows else None,
        "agreed_labels": dict(label_counts),
        "annotator_distributions": {key: dict(counts) for key, counts in by_annotator.items()},
        "review_queue": conflicts,
    }


if __name__ == "__main__":
    print(json.dumps(summarise(load_rows(Path(__file__).with_name("sample_tasks.jsonl"))), ensure_ascii=False, indent=2))
