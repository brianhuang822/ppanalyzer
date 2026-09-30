"""Small HTTP client: shared rate limit, retries with backoff, and 429 handling.

The original scraper wrapped its whole loop in a bare ``except`` that slept 10s and then
exited, so one network hiccup silently ended the run. Here every request is retried
individually and hard failures raise.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any

import requests

from . import USER_AGENT

log = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_WAIT_SECONDS = 120.0


class HttpError(RuntimeError):
    def __init__(self, url: str, status: int | None, message: str):
        super().__init__(f"{message} ({status}) for {url}")
        self.url = url
        self.status = status


class RateLimiter:
    """Thread-safe limiter: request starts are spaced at least ``1 / rate`` seconds apart,
    and everyone pauses together when the server says a window is exhausted."""

    def __init__(self, rate_per_second: float, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        self.interval = 1.0 / rate_per_second if rate_per_second > 0 else 0.0
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._next_start = 0.0
        self._paused_until = 0.0

    def acquire(self) -> None:
        with self._lock:
            now = self._clock()
            start = max(now, self._next_start, self._paused_until)
            self._next_start = start + self.interval
        delay = start - now
        if delay > 0:
            self._sleep(delay)

    def pause(self, seconds: float) -> None:
        with self._lock:
            self._paused_until = max(self._paused_until, self._clock() + min(seconds, MAX_WAIT_SECONDS))


def parse_reset(value: str | None, now_epoch: float) -> float | None:
    """Seconds until a rate-limit window resets. Servers send epoch seconds, epoch millis,
    a relative number of seconds, or (AspNetCoreRateLimit, used by BeatLeader) an ISO date."""
    if value is None:
        return None
    try:
        reset = float(value)
    except ValueError:
        try:
            reset_at = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        if reset_at.tzinfo is None:
            return None
        return max(0.0, reset_at.timestamp() - now_epoch)
    if reset > 1e12:
        return max(0.0, reset / 1000.0 - now_epoch)
    if reset > 1e9:
        return max(0.0, reset - now_epoch)
    return max(0.0, reset)


def retry_after_seconds(headers: Mapping[str, str], now_epoch: float) -> float | None:
    value = headers.get("Retry-After")
    if value is not None:
        try:
            return max(0.0, float(value))
        except ValueError:
            pass
    # ScoreSaber: x-ratelimit-remaining-short; BeatLeader: X-Rate-Limit-Remaining.
    normalized = {key.lower().replace("x-rate-limit-", "x-ratelimit-"): value
                  for key, value in headers.items()}
    waits = []
    for lower, remaining in normalized.items():
        if lower.startswith("x-ratelimit-remaining"):
            try:
                if float(remaining) > 0:
                    continue
            except ValueError:
                continue
            suffix = lower[len("x-ratelimit-remaining"):]
            reset = parse_reset(normalized.get("x-ratelimit-reset" + suffix), now_epoch)
            if reset is not None:
                waits.append(reset)
    return max(waits) if waits else None


class HttpClient:
    def __init__(self, base_url: str, rate_per_second: float = 5.0, max_retries: int = 5,
                 timeout: float = 30.0, session: requests.Session | None = None,
                 sleep: Callable[[float], None] = time.sleep):
        self.base_url = base_url.rstrip("/")
        self.limiter = RateLimiter(rate_per_second, sleep=sleep)
        self.max_retries = max_retries
        self.timeout = timeout
        self.session = session or requests.Session()
        # requests ships its own User-Agent, so assign rather than setdefault.
        self.session.headers["User-Agent"] = USER_AGENT
        self.session.headers["Accept"] = "application/json"
        self._sleep = sleep

    def url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        return f"{self.base_url}/{path.lstrip('/')}"

    def get_json(self, path: str, params: Mapping[str, Any] | None = None,
                 allow_404: bool = False) -> Any:
        url = self.url(path)
        attempt = 0
        while True:
            self.limiter.acquire()
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                if attempt >= self.max_retries:
                    raise HttpError(url, None, f"network error: {exc}") from exc
                self._backoff(attempt, f"network error {exc!r}", url)
                attempt += 1
                continue

            if response.status_code == 404 and allow_404:
                return None
            if response.status_code in RETRY_STATUSES:
                if attempt >= self.max_retries:
                    raise HttpError(url, response.status_code, "giving up after retries")
                wait = retry_after_seconds(response.headers, time.time())
                if response.status_code == 429:
                    wait = wait if wait is not None else 10.0 * (attempt + 1)
                    log.warning("429 from %s, pausing %.1fs", url, wait)
                    self.limiter.pause(wait)
                else:
                    self._backoff(attempt, f"HTTP {response.status_code}", url)
                attempt += 1
                continue
            if response.status_code >= 400:
                raise HttpError(url, response.status_code, "request failed")

            wait = retry_after_seconds(response.headers, time.time())
            if wait:
                # A window is exhausted but this request got through: stop everyone until it resets.
                self.limiter.pause(wait)
            return response.json()

    def _backoff(self, attempt: int, reason: str, url: str) -> None:
        delay = min(60.0, 2.0 ** attempt) + random.uniform(0, 0.5)
        log.warning("%s for %s, retrying in %.1fs", reason, url, delay)
        self._sleep(delay)
