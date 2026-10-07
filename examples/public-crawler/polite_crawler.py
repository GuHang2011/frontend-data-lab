"""Small, polite crawler for public pages used in a teaching demo."""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import deque
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser
from urllib.request import HTTPRedirectHandler, Request, build_opener

USER_AGENT = "GuHang2011-learning-crawler/1.0"
MAX_BODY_BYTES = 500_000
MAX_ROBOTS_BYTES = 100_000
MAX_CANDIDATES = 1000


class NoRedirect(HTTPRedirectHandler):
    """A redirect target has not been checked against scope or robots policy."""

    def redirect_request(self, request, response, code, message, headers, newurl):
        return None


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title: list[str] = []
        self.links: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "title":
            self.in_title = True
        if tag.lower() == "a":
            href = dict(attrs).get("href")
            if href and len(self.links) < MAX_CANDIDATES:
                self.links.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title.append(data.strip())


def normalise(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only absolute HTTP(S) URLs are supported")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URLs with credentials are not supported")
    host = parsed.hostname.lower()
    if ":" in host:
        host = "[" + host + "]"
    port = parsed.port
    if port is not None and port != {"http": 80, "https": 443}[parsed.scheme]:
        host += ":" + str(port)
    return urlunsplit((parsed.scheme, host, parsed.path or "/", parsed.query, ""))


def origin(url: str) -> tuple:
    parsed = urlsplit(url)
    return parsed.scheme, parsed.hostname, parsed.port or {"http": 80, "https": 443}[parsed.scheme]


def read_limited(response, limit: int) -> bytes:
    body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError("response_body_too_large")
    return body


def crawl(start: str, max_pages: int = 5, delay: float = 1.5,
          max_requests: int = 20, timeout: float = 10,
          *, opener=None, sleeper=time.sleep) -> list[dict]:
    """Return one audit record per page candidate; never follow HTTP redirects."""
    if not 1 <= max_pages <= 100 or not 2 <= max_requests <= 200:
        raise ValueError("max_pages must be 1..100 and max_requests 2..200")
    if not math.isfinite(delay) or delay < 0.5:
        raise ValueError("delay must be finite and at least 0.5 seconds")
    if not math.isfinite(timeout) or not 0 < timeout <= 60:
        raise ValueError("timeout must be finite and in (0, 60] seconds")
    start = normalise(start)
    allowed_origin = origin(start)
    opener = opener or build_opener(NoRedirect())
    requests = 0
    effective_delay = delay

    def fetch(url):
        nonlocal requests
        if requests:
            sleeper(effective_delay)
        requests += 1
        return opener.open(Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout)

    def record(url, status, **fields):
        return {"url": url, "status": status, "user_agent": USER_AGENT,
                "fetched_at": datetime.now(timezone.utc).isoformat(), **fields}

    robots_url = urljoin(start, "/robots.txt")
    robots = RobotFileParser(robots_url)
    try:
        with fetch(robots_url) as response:
            if response.status != 200 or normalise(response.geturl()) != robots_url:
                raise ValueError("robots_response_not_accepted")
            # Refuse a common HTML error page rather than interpret it as allow-all.
            if response.headers.get_content_type() != "text/plain":
                raise ValueError("robots_requires_text_plain")
            policy = read_limited(response, MAX_ROBOTS_BYTES).decode("utf-8-sig")
        robots.parse(policy.splitlines())
    except (OSError, UnicodeError, ValueError) as exc:
        if isinstance(exc, HTTPError):
            exc.close()
        return [record(robots_url, "robots_unavailable", error=type(exc).__name__)]
    crawl_delay = robots.crawl_delay(USER_AGENT)
    if crawl_delay is not None:
        effective_delay = max(effective_delay, crawl_delay)
    rate = robots.request_rate(USER_AGENT)
    if rate and rate.requests > 0:
        effective_delay = max(effective_delay, rate.seconds / rate.requests)

    queue = deque([start])
    seen: set[str] = {start}
    results: list[dict] = []
    pages = 0
    while queue and pages < max_pages and requests < max_requests:
        url = queue.popleft()
        if not robots.can_fetch(USER_AGENT, url):
            results.append(record(url, "robots_denied"))
            continue
        try:
            with fetch(url) as response:
                if origin(normalise(response.geturl())) != allowed_origin or normalise(response.geturl()) != url:
                    raise ValueError("unexpected_response_url")
                content_type = response.headers.get_content_type()
                if content_type != "text/html":
                    results.append(record(url, "skipped_content_type", content_type=content_type))
                    continue
                body = read_limited(response, MAX_BODY_BYTES).decode(response.headers.get_content_charset() or "utf-8", errors="replace")
            parser = LinkParser()
            parser.feed(body)
            links = []
            for href in parser.links:
                try:
                    child = normalise(urljoin(url, href))
                except ValueError:
                    continue
                if origin(child) != allowed_origin:
                    continue
                if child not in links:
                    links.append(child)
                if child not in seen and len(seen) < MAX_CANDIDATES:
                    seen.add(child)
                    queue.append(child)
            pages += 1
            results.append(record(url, "ok", title=" ".join(parser.title).strip(), links=links))
        except HTTPError as exc:
            status = "redirect_blocked" if 300 <= exc.code < 400 else "http_error"
            results.append(record(url, status, http_status=exc.code))
            exc.close()
        except (OSError, UnicodeError, ValueError, LookupError) as exc:
            results.append(record(url, "request_error", error=type(exc).__name__))
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--max-pages", type=int, default=5)
    parser.add_argument("--delay", type=float, default=1.5)
    parser.add_argument("--max-requests", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--output", help="UTF-8 JSONL file; otherwise write JSONL to stdout")
    args = parser.parse_args()
    try:
        records = crawl(args.url, args.max_pages, args.delay, args.max_requests, args.timeout)
    except ValueError as exc:
        parser.error(str(exc))
    output = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in records)
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(output)
    else:
        print(output, end="")
