import responses

from ppanalyzer.beatsaver import BASE_URL, enrich_maps
from ppanalyzer.models import MapInfo


def make_map(map_id: str, map_hash: str, key=None, difficulty="ExpertPlus", mode="Standard") -> MapInfo:
    return MapInfo(id=map_id, hash=map_hash, key=key, name="", sub_name="", artist="", mapper="",
                   difficulty=difficulty, mode=mode, stars=5.0, cover="")


def bs_doc(key: str, map_hash: str, **diff) -> dict:
    """A map shaped like BeatSaver's MapDetail."""
    return {
        "id": key,
        "metadata": {"bpm": 170, "duration": 200, "songName": "x"},
        "tags": ["tech", "speed"],
        "versions": [{
            "hash": map_hash,
            "diffs": [
                {"characteristic": "Standard", "difficulty": "Expert", "njs": 16, "nps": 4.1,
                 "seconds": 195.5},
                {"characteristic": "Standard", "difficulty": "ExpertPlus", "njs": 20, "nps": 6.234,
                 "seconds": 196.0, **diff},
            ],
        }],
    }


@responses.activate
def test_enriches_a_batch(no_sleep_client):
    maps = {"1": make_map("1", "aa"), "2": make_map("2", "bb"), "3": make_map("3", "cc", key="ff"),
            "4": make_map("4", "aa", difficulty="Expert")}
    responses.get(f"{BASE_URL}/maps/hash/aa,bb,cc",
                  json={"aa": bs_doc("1A2B", "aa", ne=True), "bb": None, "cc": bs_doc("9", "cc")})
    assert enrich_maps(maps, no_sleep_client(BASE_URL)) == 3
    one, two, three, four = (maps[i] for i in "1234")
    assert (one.key, one.duration, one.tags, one.njs, one.nps, one.mods) == (
        "1a2b", 196.0, ["tech", "speed"], 20.0, 6.23, ["Noodle Extensions"])
    assert (four.key, four.njs, four.nps, four.duration, four.mods) == ("1a2b", 16.0, 4.1, 195.5, [])
    assert two.key is None and two.duration is None
    assert three.key == "ff"  # an existing key is kept


@responses.activate
def test_single_hash_returns_map_object(no_sleep_client):
    maps = {"1": make_map("1", "aa")}
    responses.get(f"{BASE_URL}/maps/hash/aa", json=bs_doc("9f", "aa"))
    assert enrich_maps(maps, no_sleep_client(BASE_URL)) == 1
    assert maps["1"].key == "9f"


@responses.activate
def test_failures_are_not_fatal(no_sleep_client):
    maps = {"1": make_map("1", "aa")}
    responses.get(f"{BASE_URL}/maps/hash/aa", status=500)
    assert enrich_maps(maps, no_sleep_client(BASE_URL, max_retries=0)) == 0
    assert maps["1"].key is None


def test_nothing_to_do():
    assert enrich_maps({"1": make_map("1", "")}) == 0
