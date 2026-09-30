import pytest
import requests
import responses

from ppanalyzer.http import HttpClient, HttpError, RateLimiter, parse_reset, retry_after_seconds

BASE = "https://api.example.com"


class FakeClock:
    def __init__(self):
        self.now = 100.0
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def test_rate_limiter_spaces_requests():
    fake = FakeClock()
    limiter = RateLimiter(4.0, clock=fake.clock, sleep=fake.sleep)
    for _ in range(3):
        limiter.acquire()
    assert fake.sleeps == pytest.approx([0.25, 0.25])


def test_rate_limiter_pause_blocks_next_request():
    fake = FakeClock()
    limiter = RateLimiter(0, clock=fake.clock, sleep=fake.sleep)
    limiter.pause(5)
    limiter.acquire()
    assert fake.sleeps == pytest.approx([5.0])


@pytest.mark.parametrize("value, expected", [("30", 30.0), ("1700000060", 60.0), ("1700000060000", 60.0),
                                             ("junk", None), (None, None)])
def test_parse_reset(value, expected):
    assert parse_reset(value, now_epoch=1_700_000_000) == expected


def test_retry_after_prefers_header_then_exhausted_bucket():
    assert retry_after_seconds({"Retry-After": "7"}, 0) == 7.0
    headers = {"x-ratelimit-remaining-short": "0", "x-ratelimit-reset-short": "3",
               "x-ratelimit-remaining-long": "120", "x-ratelimit-reset-long": "50"}
    assert retry_after_seconds(headers, 0) == 3.0
    assert retry_after_seconds({"x-ratelimit-remaining-short": "5"}, 0) is None


def test_retry_after_understands_aspnet_rate_limit_headers():
    headers = {"X-Rate-Limit-Remaining": "0", "X-Rate-Limit-Reset": "2023-11-14T22:13:25Z"}
    assert retry_after_seconds(headers, now_epoch=1_700_000_000) == 5.0


@responses.activate
def test_retries_server_errors_then_succeeds(no_sleep_client):
    responses.get(f"{BASE}/thing", status=502)
    responses.get(f"{BASE}/thing", json={"ok": True})
    assert no_sleep_client(BASE).get_json("thing") == {"ok": True}
    assert len(responses.calls) == 2


@responses.activate
def test_429_pauses_limiter_and_retries(no_sleep_client):
    responses.get(f"{BASE}/thing", status=429, headers={"Retry-After": "12"})
    responses.get(f"{BASE}/thing", json=[1])
    client = no_sleep_client(BASE)
    assert client.get_json("thing") == [1]
    assert client.limiter._paused_until > 0


@responses.activate
def test_gives_up_after_max_retries(no_sleep_client):
    for _ in range(3):
        responses.get(f"{BASE}/thing", status=500)
    with pytest.raises(HttpError) as err:
        no_sleep_client(BASE, max_retries=2).get_json("thing")
    assert err.value.status == 500


@responses.activate
def test_404_optional(no_sleep_client):
    responses.get(f"{BASE}/missing", status=404)
    assert no_sleep_client(BASE).get_json("missing", allow_404=True) is None
    responses.get(f"{BASE}/missing2", status=404)
    with pytest.raises(HttpError):
        no_sleep_client(BASE).get_json("missing2")


@responses.activate
def test_network_errors_are_retried(no_sleep_client):
    responses.get(f"{BASE}/flaky", body=requests.ConnectionError("reset"))
    responses.get(f"{BASE}/flaky", json={"ok": 1})
    assert no_sleep_client(BASE).get_json("flaky") == {"ok": 1}


@responses.activate
def test_sends_user_agent(no_sleep_client):
    responses.get(f"{BASE}/ua", json={})
    no_sleep_client(BASE).get_json("ua")
    assert "ppanalyzer" in responses.calls[0].request.headers["User-Agent"]


def test_absolute_urls_pass_through():
    assert HttpClient(BASE).url("https://other.example/x") == "https://other.example/x"
    assert HttpClient(BASE + "/").url("/a/b") == f"{BASE}/a/b"
