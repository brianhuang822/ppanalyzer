import responses

from ppanalyzer.beatsaver import BASE_URL, resolve_keys
from ppanalyzer.models import MapInfo


def make_map(map_id: str, map_hash: str, key=None) -> MapInfo:
    return MapInfo(id=map_id, hash=map_hash, key=key, name="", sub_name="", artist="", mapper="",
                   difficulty="Expert", mode="Standard", stars=5.0, cover="")


@responses.activate
def test_resolves_batch(no_sleep_client):
    maps = {"1": make_map("1", "aa"), "2": make_map("2", "bb"), "3": make_map("3", "cc", key="ff"),
            "4": make_map("4", "aa")}
    responses.get(f"{BASE_URL}/maps/hash/aa,bb", json={"aa": {"id": "1A2B"}, "bb": None})
    assert resolve_keys(maps, no_sleep_client(BASE_URL)) == 2
    assert [maps[i].key for i in "1234"] == ["1a2b", None, "ff", "1a2b"]


@responses.activate
def test_single_hash_returns_map_object(no_sleep_client):
    maps = {"1": make_map("1", "aa")}
    responses.get(f"{BASE_URL}/maps/hash/aa", json={"id": "9f", "name": "x"})
    assert resolve_keys(maps, no_sleep_client(BASE_URL)) == 1
    assert maps["1"].key == "9f"


@responses.activate
def test_failures_are_not_fatal(no_sleep_client):
    maps = {"1": make_map("1", "aa")}
    responses.get(f"{BASE_URL}/maps/hash/aa", status=500)
    assert resolve_keys(maps, no_sleep_client(BASE_URL, max_retries=0)) == 0
    assert maps["1"].key is None


def test_nothing_to_do():
    assert resolve_keys({"1": make_map("1", "aa", key="1")}) == 0
