"""Aggregate a raw snapshot into the static JSON the web app reads.

<out>/meta.json              snapshot facts (decay, bucket size, coverage, timestamps)
<out>/maps.json              every ranked map seen, as rows (see MAP_FIELDS), plus global stats
<out>/buckets/<b>.json       per-map stats for players ranked b*size+1 .. (b+1)*size
<out>/players/<shard>.json   each player's top plays, for personal lookups without a live API
<out>/players/index.json     [id, name, rank] for every player, for name search
<site>/sources.json          which sources exist (rewritten on every build)

Buckets are keyed on each player's *actual* rank. The 2021 version used the position in a
list of whichever pickle files existed, so every missing file shifted all later ranks.
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from pathlib import Path

from .fetch import load_maps, load_players, now_iso
from .models import MapInfo, PlayerRecord

MAP_FIELDS = ["id", "hash", "key", "name", "subName", "artist", "mapper", "difficulty", "mode", "stars",
              "cover", "globalCount", "globalWeight"]
BUCKET_FIELDS = ["map", "count", "weight", "ppSum", "accSum"]
SCORE_FIELDS = ["map", "pp", "acc"]


def fnv1a32(text: str) -> int:
    """32-bit FNV-1a over UTF-8 bytes; mirrored in web/src/lib/shard.ts."""
    value = 0x811C9DC5
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 0x01000193) & 0xFFFFFFFF
    return value


def shard_of(player_id: str, shard_count: int) -> int:
    return fnv1a32(player_id) % shard_count


def _dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build_site_data(raw_dir: Path, out_dir: Path, bucket_size: int = 100, shard_count: int = 256,
                    sample: bool = False) -> dict:
    raw_meta = json.loads((raw_dir / "meta.json").read_text())
    players = load_players(raw_dir / "players.jsonl")
    maps = load_maps(raw_dir / "leaderboards.jsonl")
    decay = float(raw_meta.get("decay") or 0.965)
    return build_from_records(players, maps, raw_meta, out_dir, decay, bucket_size, shard_count, sample)


def build_from_records(players: list[PlayerRecord], maps: dict[str, MapInfo], raw_meta: dict, out_dir: Path,
                       decay: float, bucket_size: int, shard_count: int, sample: bool = False) -> dict:
    if bucket_size < 1 or shard_count < 1:
        raise ValueError("bucket_size and shard_count must be positive")

    # A player can appear twice if ranks shifted while paginating; keep the first (best) rank.
    unique: dict[str, PlayerRecord] = {}
    for player in sorted(players, key=lambda p: p.rank):
        unique.setdefault(player.id, player)
    players = [p for p in unique.values() if p.scores]

    global_count: dict[str, int] = defaultdict(int)
    global_weight: dict[str, float] = defaultdict(float)
    buckets: dict[int, dict[str, list[float]]] = defaultdict(dict)
    bucket_players: dict[int, list[int]] = defaultdict(list)

    for player in players:
        b = (player.rank - 1) // bucket_size
        bucket_players[b].append(player.rank)
        stats = buckets[b]
        for position, (map_id, pp, acc) in enumerate(player.scores):
            if map_id not in maps:
                continue
            weight = decay ** position
            global_count[map_id] += 1
            global_weight[map_id] += weight
            row = stats.get(map_id)
            if row is None:
                row = stats[map_id] = [0, 0.0, 0.0, 0.0]
            row[0] += 1
            row[1] += weight
            row[2] += pp
            row[3] += acc

    ordered_ids = sorted(global_weight, key=lambda m: (-global_weight[m], m))
    index = {map_id: i for i, map_id in enumerate(ordered_ids)}

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    map_rows = []
    for map_id in ordered_ids:
        info = maps[map_id]
        map_rows.append([info.id, info.hash, info.key, info.name, info.sub_name, info.artist, info.mapper,
                         info.difficulty, info.mode, round(info.stars, 2), info.cover,
                         global_count[map_id], round(global_weight[map_id], 3)])
    _dump(out_dir / "maps.json", {"fields": MAP_FIELDS, "rows": map_rows})

    bucket_count = (max(p.rank for p in players) - 1) // bucket_size + 1 if players else 0
    for b in range(bucket_count):
        ranks = bucket_players.get(b, [])
        rows = [[index[m], s[0], round(s[1], 4), round(s[2], 1), round(s[3], 4)]
                for m, s in buckets.get(b, {}).items()]
        rows.sort(key=lambda r: -r[2])
        _dump(out_dir / "buckets" / f"{b}.json", {
            "bucket": b,
            "players": len(ranks),
            "minRank": min(ranks) if ranks else b * bucket_size + 1,
            "maxRank": max(ranks) if ranks else (b + 1) * bucket_size,
            "fields": BUCKET_FIELDS,
            "rows": rows,
        })

    shards: dict[int, dict] = defaultdict(dict)
    for player in players:
        shards[shard_of(player.id, shard_count)][player.id] = {
            "name": player.name,
            "country": player.country,
            "rank": player.rank,
            "pp": round(player.pp, 2),
            "scores": [[index[m], pp, acc] for m, pp, acc in player.scores if m in index],
        }
    for shard in range(shard_count):
        _dump(out_dir / "players" / f"{shard}.json",
              {"fields": SCORE_FIELDS, "players": shards.get(shard, {})})
    _dump(out_dir / "players" / "index.json", [[p.id, p.name, p.rank] for p in players])

    meta = {
        "source": raw_meta.get("source"),
        "label": raw_meta.get("label"),
        "realm": raw_meta.get("realm"),
        "sample": sample or bool(raw_meta.get("sample")),
        "decay": decay,
        "bucketSize": bucket_size,
        "bucketCount": bucket_count,
        "shardCount": shard_count,
        "playerCount": len(players),
        "mapCount": len(map_rows),
        "minRank": players[0].rank if players else 0,
        "maxRank": players[-1].rank if players else 0,
        "scoresPerPlayer": raw_meta.get("scoresPerPlayer"),
        "fetchedAt": raw_meta.get("fetchedAt"),
        "builtAt": now_iso(),
    }
    _dump(out_dir / "meta.json", meta)
    write_sources_index(out_dir.parent)
    return meta


def write_sources_index(site_dir: Path) -> list[dict]:
    """List every source directory that has a meta.json so the app knows what it can offer."""
    preferred = {"scoresaber": 0, "beatleader": 1}
    sources = []
    for meta_path in sorted(site_dir.glob("*/meta.json")):
        meta = json.loads(meta_path.read_text())
        sources.append({
            "id": meta_path.parent.name,
            "label": meta.get("label") or meta_path.parent.name,
            "sample": bool(meta.get("sample")),
            "fetchedAt": meta.get("fetchedAt"),
        })
    sources.sort(key=lambda s: (preferred.get(s["id"], 99), s["id"]))
    _dump(site_dir / "sources.json", {"sources": sources})
    return sources
