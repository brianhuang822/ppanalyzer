"""fetch (in two rank-range parts) -> merge -> enrich -> build through the real HTTP client,
thread pool and BeatSaver lookups, against mocked servers."""

import json
import re

import responses
from conftest import page, ss_player, ss_score

from ppanalyzer import beatsaver
from ppanalyzer.build import build_site_data
from ppanalyzer.fetch import enrich_snapshot, fetch_snapshot, load_maps, merge_snapshots
from ppanalyzer.http import HttpClient
from ppanalyzer.sources.scoresaber import BASE_URL, ScoreSaberSource


@responses.activate
def test_scoresaber_fetch_then_build(tmp_path, monkeypatch):
    players = [ss_player(str(1000 + r), r, pp=20000 - r) for r in range(1, 151)]

    def listing(page_number):
        params = {"page": str(page_number), "limit": "100", "sort": "rank", "sortDirection": "asc"}
        return [responses.matchers.query_param_matcher(params)]

    responses.get(f"{BASE_URL}/players", match=listing(1), json=page(players[:100], 1, 2))
    responses.get(f"{BASE_URL}/players", match=listing(2), json=page(players[100:], 2, 2))
    responses.get(f"{BASE_URL}/players", match=listing(1), json=page(players[:100], 1, 2))

    def scores(request):
        player_id = int(re.search(r"/players/(\d+)/scores", request.url).group(1))
        rank = player_id - 1000
        # Everyone plays map 1; map 2 only in the top 100; map 3 has no BeatSaver key.
        items = [ss_score(1, 400 - rank, weight=1.0)]
        if rank <= 100:
            items.append(ss_score(2, 390 - rank, weight=0.965))
        items.append(ss_score(3, 100, weight=0.931225, bsid=None))
        return 200, {}, json.dumps(page(items, 1, 1))

    responses.add_callback(responses.GET, re.compile(rf"{re.escape(BASE_URL)}/players/\d+/scores.*"),
                           callback=scores)
    responses.get(f"{BASE_URL}/realms", json=[{"id": 1, "name": "Main", "decayFactor": 0.965}])
    def beatsaver_lookup(request):
        hashes = request.url.rsplit("/", 1)[1].split(",")
        docs = {h: {"id": "3C" if h == f"{3:040x}" else "2a1b", "metadata": {"duration": 150 + i},
                    "tags": ["speed"], "versions": []} for i, h in enumerate(hashes)}
        return 200, {}, json.dumps(docs)

    responses.add_callback(responses.GET, re.compile(rf"{re.escape(beatsaver.BASE_URL)}/maps/hash/.*"),
                           callback=beatsaver_lookup)
    monkeypatch.setattr(beatsaver, "HttpClient",
                        lambda base, **kw: HttpClient(base, rate_per_second=0, sleep=lambda _s: None))

    def source():
        return ScoreSaberSource(HttpClient(BASE_URL, rate_per_second=0, sleep=lambda _s: None))

    first = fetch_snapshot(source(), tmp_path / "part1", max_rank=70, scores_per_player=100, workers=4)
    second = fetch_snapshot(source(), tmp_path / "part2", max_rank=140, scores_per_player=100, workers=4,
                            min_rank=71)
    assert (first["playerCount"], second["playerCount"]) == (70, 70)
    raw = tmp_path / "raw"
    meta = merge_snapshots([tmp_path / "part1", tmp_path / "part2"], raw)
    assert meta["playerCount"] == 140 and meta["mapCount"] == 3
    assert meta["realm"] == "Main" and meta["decay"] == 0.965
    assert enrich_snapshot(raw) == 3
    durations = {m: info.duration for m, info in load_maps(raw / "leaderboards.jsonl").items()}
    assert all(durations.values())

    site = build_site_data(raw, tmp_path / "site" / "scoresaber", shard_count=8)
    assert site["bucketCount"] == 2 and site["maxRank"] == 140
    maps = json.loads((tmp_path / "site" / "scoresaber" / "maps.json").read_text())
    keys = {row[0]: row[2] for row in maps["rows"]}
    assert keys == {"1": "2a1b", "2": "2a1b", "3": "3c"}
    bucket1 = json.loads((tmp_path / "site" / "scoresaber" / "buckets" / "1.json").read_text())
    assert bucket1["players"] == 40 and bucket1["minRank"] == 101 and bucket1["maxRank"] == 140
    ids = [row[0] for row in maps["rows"]]
    assert "2" not in {ids[row[0]] for row in bucket1["rows"]}
