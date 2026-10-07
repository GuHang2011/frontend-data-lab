"""Offline boundary tests; no HTTP requests or real sleeps are performed."""

import importlib.util
import io
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError
import unittest


def load_example(name, relative):
    path = Path(__file__).resolve().parents[1] / "examples" / relative
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


labeling = load_example("label_quality", "data-labeling/label_quality.py")
crawler = load_example("polite_crawler", "public-crawler/polite_crawler.py")
BASE = "https://example.test"


class LabelQualityTests(unittest.TestCase):
    def row(self, id_, labels):
        return {"id": id_, "text": "Synthetic task", "labels": labels}

    def test_missing_labels_do_not_count_as_agreement(self):
        result = labeling.summarise([
            self.row("one", {"ann-a": "academic"}),
            self.row("empty", {}),
            self.row("agree", {"ann-a": "academic", "ann-b": "academic"}),
            self.row("conflict", {"ann-a": "academic", "ann-b": "other"}),
        ])
        self.assertEqual(result["complete_items"], 2)
        self.assertEqual(result["agreed_items"], 1)
        self.assertEqual(result["agreement_rate"], 0.5)
        self.assertEqual(result["coverage"], 0.5)
        self.assertEqual([row["reason"] for row in result["review_queue"]],
                         ["incomplete", "incomplete", "disagreement"])

    def test_empty_and_incomplete_sets_have_undefined_agreement(self):
        for rows in ([], [self.row("one", {"ann-a": "academic"})]):
            self.assertIsNone(labeling.summarise(rows)["agreement_rate"])

    def test_rejects_unknown_labels_annotators_and_duplicate_ids(self):
        for labels in ({"ann-a": "typo"}, {"unknown": "academic"}, {"ann-a": None}):
            with self.subTest(labels=labels), self.assertRaises(ValueError):
                labeling.summarise([self.row("one", labels)])
        row = self.row("duplicate", {})
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            labeling.summarise([row, row])

    def test_committed_fixture_matches_documented_statistics(self):
        path = Path(labeling.__file__).with_name("sample_tasks.jsonl")
        result = labeling.summarise(labeling.load_rows(path))
        self.assertEqual(result["items"], 5)
        self.assertEqual(result["agreement_rate"], 0.75)
        self.assertEqual(result["coverage"], 0.8)


class Response:
    def __init__(self, url, body, content_type="text/html", status=200):
        self.url = url
        self.body = body.encode("utf-8") if isinstance(body, str) else body
        self.status = status
        self.headers = Message()
        self.headers["Content-Type"] = content_type

    def geturl(self):
        return self.url

    def read(self, size):
        return self.body[:size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeOpener:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def open(self, request, timeout):
        self.calls.append((request.full_url, timeout, request.get_header("User-agent")))
        result = self.routes[request.full_url]
        if isinstance(result, Exception):
            raise result
        return result


class CrawlerTests(unittest.TestCase):
    def run_crawl(self, routes, policy="User-agent: *\nAllow: /\n", **kwargs):
        robots_url = BASE + "/robots.txt"
        opener = FakeOpener({robots_url: Response(robots_url, policy, "text/plain"), **routes})
        sleeps = []
        result = crawler.crawl(BASE, opener=opener, sleeper=sleeps.append, **kwargs)
        return result, opener.calls, sleeps

    def test_scope_dedup_robots_and_audit_fields(self):
        html = ('<title>Demo</title><a href="/allowed#first">a</a>'
                '<a href="/allowed#again">a</a><a href="/private">p</a>'
                '<a href="https://other.test/">offsite</a>'
                '<a href="http://example.test/">different scheme</a>'
                '<a href="https://example.test:444/">different port</a>')
        routes = {BASE + "/": Response(BASE + "/", html),
                  BASE + "/allowed": Response(BASE + "/allowed", "<title>Next</title>")}
        result, calls, sleeps = self.run_crawl(routes, policy="User-agent: *\nDisallow: /private\n")
        self.assertEqual([call[0] for call in calls], [BASE + "/robots.txt", BASE + "/", BASE + "/allowed"])
        self.assertEqual([row["status"] for row in result], ["ok", "ok", "robots_denied"])
        self.assertEqual(result[0]["links"], [BASE + "/allowed", BASE + "/private"])
        self.assertTrue(all(row["fetched_at"] and row["user_agent"] == crawler.USER_AGENT for row in result))
        self.assertEqual(sleeps, [1.5, 1.5])

    def test_redirects_are_not_followed(self):
        error = HTTPError(BASE + "/", 302, "Found", {"Location": "https://other.test/"}, io.BytesIO())
        result, calls, _ = self.run_crawl({BASE + "/": error})
        self.assertEqual(result[0]["status"], "redirect_blocked")
        self.assertEqual(len(calls), 2)
        self.assertIsNone(crawler.NoRedirect().redirect_request(None, None, 302, "", {}, BASE + "/private"))

    def test_every_attempt_respects_delay_and_request_budget(self):
        routes = {
            BASE + "/": Response(BASE + "/", '<a href="/file">f</a><a href="/fail">e</a><a href="/extra">x</a>'),
            BASE + "/file": Response(BASE + "/file", "binary", "application/octet-stream"),
            BASE + "/fail": OSError("offline timeout"),
        }
        result, calls, sleeps = self.run_crawl(routes, max_requests=4, timeout=2,
                                              policy="User-agent: *\nCrawl-delay: 3\nAllow: /\n")
        self.assertEqual(len(calls), 4)  # Includes robots and failed/non-HTML attempts.
        self.assertEqual([row["status"] for row in result], ["ok", "skipped_content_type", "request_error"])
        self.assertEqual(sleeps, [3, 3, 3])
        self.assertTrue(all(call[1] == 2 for call in calls))

    def test_missing_or_html_robots_stops_before_page_fetch(self):
        for response in (OSError("offline"), Response(BASE + "/robots.txt", "error", "text/html")):
            result, calls, sleeps = self.run_crawl({BASE + "/robots.txt": response})
            self.assertEqual(result[0]["status"], "robots_unavailable")
            self.assertEqual(len(calls), 1)
            self.assertEqual(sleeps, [])

    def test_size_and_successful_page_bounds(self):
        result, _, _ = self.run_crawl({BASE + "/": Response(BASE + "/", b"x" * (crawler.MAX_BODY_BYTES + 1))})
        self.assertEqual(result[0]["status"], "request_error")
        result, calls, _ = self.run_crawl({BASE + "/": Response(BASE + "/", '<a href="/more">more</a>')}, max_pages=1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result[0]["status"], "ok")

    def test_invalid_limits_and_urls_fail_before_network(self):
        for kwargs in ({"max_pages": 0}, {"max_requests": 1}, {"delay": float("nan")},
                       {"delay": 0}, {"timeout": float("inf")}, {"timeout": -1}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                crawler.crawl(BASE, opener=FakeOpener({}), **kwargs)
        for url in ("file:///tmp/test", "https://user:pass@example.test/", "relative/path"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                crawler.normalise(url)
        self.assertEqual(crawler.normalise("https://EXAMPLE.test:443/#anchor"), BASE + "/")


if __name__ == "__main__":
    unittest.main()
