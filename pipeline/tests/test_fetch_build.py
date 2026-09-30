import json

import pytest

from ppanalyzer.build import build_from_records, build_site_data, fnv1a32, shard_of, write_sources_index
from ppanalyzer.cli import main
from ppanalyzer.fetch import fetch_snapshot, load_players
from ppanalyzer.models import MapInfo, PlayerRecord


def make_map(map_id: str, key: str | None = "1") -> MapInfo:
    return MapInfo(id=map_id, hash="h" + map_id, key=key, name=f"Song {map_id}", sub_name="", artist="A",
                   mapper="M", difficulty="Expert", mode="Standard", stars=5.0, cover="")


class FakeSource:
    id = "fake"
    label = "Fake"

    def __init__(self, players, scores, fail=()):
        self.players = players
        self.scores = scores
        self.fail = set(fail)
        self.fetched = []

    def iter_players(self, max_rank):
        for player in self.players:
            if player.rank <= max_rank:
                yield PlayerRecord(player.id, player.name, player.country, player.rank, player.pp)

    def fetch_top_scores(self, player_id, count):
        self.fetched.append(player_id)
        if player_id in self.fail:
            raise RuntimeError("boom")
        rows = self.scores[player_id][:count]
        weights = [0.965 ** i for i in range(len(rows))]
        return rows, [make_map(r[0]) for r in rows], weights

    def realm_info(self):
        return {"realm": "Main", "advertisedDecay": 0.965}


def roster(n):
    return [PlayerRecord(str(i), f"P{i}", "US", i, 1000.0 - i) for i in range(1, n + 1)]


def test_fetch_writes_snapshot_and_resumes(tmp_path):
    players = roster(5)
    scores = {p.id: [["m1", 300.0, 0.95], ["m2", 250.0, 0.94], ["m3", 200.0, 0.93]] for p in players}
    source = FakeSource(players, scores, fail={"3"})
    meta = fetch_snapshot(source, tmp_path, max_rank=4, scores_per_player=2, workers=2,
                          resolve_beatsaver=False)
    saved = load_players(tmp_path / "players.jsonl")
    assert sorted(p.id for p in saved) == ["1", "2", "4"]
    assert all(len(p.scores) == 2 for p in saved)
    assert meta["failedPlayers"] == ["3"] and meta["decay"] == pytest.approx(0.965)
    maps = [json.loads(line)["id"] for line in (tmp_path / "leaderboards.jsonl").read_text().splitlines()]
    assert sorted(maps) == ["m1", "m2"]

    # A second run only fetches what is missing.
    source2 = FakeSource(players, scores)
    fetch_snapshot(source2, tmp_path, max_rank=4, scores_per_player=2, workers=2, resolve_beatsaver=False)
    assert source2.fetched == ["3"]
    assert len(load_players(tmp_path / "players.jsonl")) == 4


def test_fetch_aborts_when_too_many_fail(tmp_path):
    players = roster(12)
    scores = {p.id: [["m1", 1.0, 0.9]] for p in players}
    source = FakeSource(players, scores, fail={str(i) for i in range(1, 13)})
    with pytest.raises(RuntimeError):
        fetch_snapshot(source, tmp_path, 100, 1, resolve_beatsaver=False)
    assert not (tmp_path / "meta.json").exists()


def test_build_buckets_use_actual_rank(tmp_path):
    maps = {m: make_map(m) for m in ["a", "b", "c"]}
    # Rank 3 is missing (e.g. a failed fetch). Rank 101 must still land in bucket 1, and rank 100
    # must land in bucket 0 (the 2021 app put rank 100 in the 101-200 bucket).
    players = [
        PlayerRecord("p1", "One", "US", 1, 900, [["a", 400.0, 0.96], ["b", 300.0, 0.95]]),
        PlayerRecord("p2", "Two", "US", 2, 800, [["a", 380.0, 0.955]]),
        PlayerRecord("p100", "Hundred", "US", 100, 500, [["b", 250.0, 0.94], ["c", 200.0, 0.93]]),
        PlayerRecord("p101", "HundredOne", "US", 101, 490, [["c", 210.0, 0.935]]),
        PlayerRecord("p101", "Dupe", "US", 150, 400, [["a", 1.0, 0.5]]),  # duplicate id, worse rank
        PlayerRecord("empty", "Empty", "US", 102, 480, []),
    ]
    out = tmp_path / "site" / "src1"
    meta = build_from_records(players, maps, {"source": "src1", "label": "Src 1", "fetchedAt": "t"}, out,
                              decay=0.9, bucket_size=100, shard_count=4)
    assert meta["playerCount"] == 4 and meta["bucketCount"] == 2 and meta["maxRank"] == 101

    maps_json = json.loads((out / "maps.json").read_text())
    ids = [row[0] for row in maps_json["rows"]]
    fields = maps_json["fields"]
    by_id = {row[0]: dict(zip(fields, row, strict=True)) for row in maps_json["rows"]}
    assert by_id["a"]["globalCount"] == 2 and by_id["a"]["globalWeight"] == pytest.approx(2.0)
    assert by_id["b"]["globalWeight"] == pytest.approx(0.9 + 1.0)
    assert by_id["c"]["globalWeight"] == pytest.approx(0.9 + 1.0)

    b0 = json.loads((out / "buckets" / "0.json").read_text())
    b1 = json.loads((out / "buckets" / "1.json").read_text())
    assert (b0["players"], b0["minRank"], b0["maxRank"]) == (3, 1, 100)
    assert (b1["players"], b1["minRank"], b1["maxRank"]) == (1, 101, 101)
    rows0 = {ids[r[0]]: r[1:] for r in b0["rows"]}
    assert rows0["a"] == [2, pytest.approx(2.0), 780.0, pytest.approx(1.915)]
    assert rows0["b"] == [2, pytest.approx(1.9), 550.0, pytest.approx(1.89)]
    assert {ids[r[0]] for r in b1["rows"]} == {"c"}

    shard = shard_of("p101", 4)
    players_json = json.loads((out / "players" / f"{shard}.json").read_text())
    assert players_json["players"]["p101"]["rank"] == 101
    assert players_json["players"]["p101"]["scores"] == [[ids.index("c"), 210.0, 0.935]]
    index = json.loads((out / "players" / "index.json").read_text())
    assert ["p101", "HundredOne", 101] in index and len(index) == 4

    sources = json.loads((tmp_path / "site" / "sources.json").read_text())["sources"]
    assert sources == [{"id": "src1", "label": "Src 1", "sample": False, "fetchedAt": "t"}]


def test_fnv1a_matches_reference_vectors():
    # Published FNV-1a 32-bit test vectors; the web app uses the same function.
    assert fnv1a32("") == 0x811C9DC5
    assert fnv1a32("a") == 0xE40C292C
    assert fnv1a32("foobar") == 0xBF9CF968
    assert shard_of("76561198000000000", 256) == fnv1a32("76561198000000000") % 256


def test_sources_index_orders_known_sources_first(tmp_path):
    for name in ["zzz", "beatleader", "scoresaber"]:
        (tmp_path / name).mkdir()
        (tmp_path / name / "meta.json").write_text(json.dumps({"label": name.title()}))
    assert [s["id"] for s in write_sources_index(tmp_path)] == ["scoresaber", "beatleader", "zzz"]


def test_cli_sample_then_build(tmp_path):
    raw = tmp_path / "raw"
    site = tmp_path / "site"
    assert main(["sample", "--out", str(raw), "--players", "300", "--maps", "120"]) == 0
    assert main(["build", "--raw", str(raw), "--out", str(site / "sample"), "--shards", "8"]) == 0
    meta = json.loads((site / "sample" / "meta.json").read_text())
    assert meta["sample"] is True and meta["playerCount"] == 300 and meta["bucketCount"] == 3
    assert meta["minRank"] == 1 and meta["maxRank"] == 300
    assert len(list((site / "sample" / "players").glob("*.json"))) == 9  # 8 shards + index
    # Deterministic: same seed, same data.
    raw2 = tmp_path / "raw2"
    main(["sample", "--out", str(raw2), "--players", "300", "--maps", "120"])
    assert (raw / "players.jsonl").read_text() == (raw2 / "players.jsonl").read_text()
    build_site_data(raw2, site / "sample2", shard_count=8)
