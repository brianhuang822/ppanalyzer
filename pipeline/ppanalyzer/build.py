"""Aggregate a raw snapshot into the static JSON the web app reads.

<out>/meta.json              snapshot facts, the fitted pp curve, coverage, timestamps
<out>/maps.json              every ranked map seen, as rows (see MAP_FIELDS), plus global stats
<out>/buckets/<b>.json       per-map stats for players ranked b*size+1 .. (b+1)*size, the band's
                             accuracy-by-stars curve and its "typical player" pp profile
<out>/players/<shard>.json   each player's best plays, for personal lookups without a live API
<out>/players/index.json     [id, name, rank] for every player, for name search
<site>/sources.json          which sources exist (rewritten on every build)

Buckets are keyed on each player's *actual* rank. The 2021 version used the position in a
list of whichever pickle files existed, so every missing file shifted all later ranks.
See model.py for how "overweighted" is measured.
"""

from __future__ import annotations

import json
import shutil
import statistics
from collections import defaultdict
from pathlib import Path

from .fetch import load_maps, load_players, now_iso
from .model import (
    fit_band,
    fit_pp_curve,
    map_pp_scale,
    typical_profile,
)
from .models import MapInfo, PlayerRecord, parse_timestamp

MAP_FIELDS = ["id", "hash", "key", "name", "subName", "artist", "mapper", "difficulty", "mode", "stars",
              "cover", "globalCount", "globalWeight", "ppScale", "rankedAt", "duration", "tags", "njs", "nps",
              "mods"]
# residSum: sum over players of (acc - typical acc at these stars - player's offset); the app
# pools neighbouring buckets and shrinks it into the map's overweight. recent: plays set in
# the last RECENT_DAYS days ("being farmed right now").
BUCKET_FIELDS = ["map", "count", "weight", "ppSum", "accSum", "residSum", "recent"]
SCORE_FIELDS = ["map", "pp", "acc"]
SNAPSHOT_PLAYS = 100
RECENT_DAYS = 30


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


def _plays(player: PlayerRecord):
    """(map_id, pp, acc, set_at) for every row, accepting old 3-column rows."""
    for row in player.scores:
        yield row[0], float(row[1]), float(row[2]), int(row[3]) if len(row) > 3 else 0


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

    # 1. pp as a function of accuracy, fitted from every play, then each map's pp scale.
    curve, curve_fitted = fit_pp_curve(
        (acc, pp / maps[m].stars) for p in players for m, pp, acc, _ in _plays(p)
        if m in maps and maps[m].stars > 0)
    per_map_obs: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for player in players:
        for map_id, pp, acc, _ in _plays(player):
            if map_id in maps:
                per_map_obs[map_id].append((acc, pp))
    pp_scale = {m: map_pp_scale(obs, curve) for m, obs in per_map_obs.items()}
    del per_map_obs

    fetched_at = parse_timestamp(raw_meta.get("fetchedAt")) or max(
        (ts for p in players for _, _, _, ts in _plays(p)), default=0)
    recent_cutoff = fetched_at - RECENT_DAYS * 86400

    # 2. Per-bucket statistics, including the overweight residuals.
    global_count: dict[str, int] = defaultdict(int)
    global_weight: dict[str, float] = defaultdict(float)
    by_bucket: dict[int, list[PlayerRecord]] = defaultdict(list)
    for player in players:
        by_bucket[(player.rank - 1) // bucket_size].append(player)
        for position, (map_id, _, _, _) in enumerate(_plays(player)):
            if map_id in maps:
                global_count[map_id] += 1
                global_weight[map_id] += decay ** position

    ordered_ids = sorted(global_weight, key=lambda m: (-global_weight[m], m))
    index = {map_id: i for i, map_id in enumerate(ordered_ids)}

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    bucket_count = (max(p.rank for p in players) - 1) // bucket_size + 1 if players else 0
    for b in range(bucket_count):
        members = by_bucket.get(b, [])
        plays = [(i, m, maps[m].stars, acc) for i, p in enumerate(members) for m, _, acc, _ in _plays(p)
                 if m in maps and maps[m].stars > 0]
        acc_curve, _, residuals = fit_band(plays)
        stats: dict[str, list[float]] = {}
        for player in members:
            for position, (map_id, pp, acc, set_at) in enumerate(_plays(player)):
                if map_id not in maps:
                    continue
                row = stats.setdefault(map_id, [0, 0.0, 0.0, 0.0, 0])
                row[0] += 1
                row[1] += decay ** position
                row[2] += pp
                row[3] += acc
                row[4] += 1 if set_at and set_at >= recent_cutoff else 0
        rows = [[index[m], s[0], round(s[1], 4), round(s[2], 1), round(s[3], 4),
                 round(residuals.get(m, [0, 0.0])[1], 5), s[4]] for m, s in stats.items()]
        rows.sort(key=lambda r: -r[2])
        ranks = [p.rank for p in members]
        _dump(out_dir / "buckets" / f"{b}.json", {
            "bucket": b,
            "players": len(members),
            "minRank": min(ranks) if ranks else b * bucket_size + 1,
            "maxRank": max(ranks) if ranks else (b + 1) * bucket_size,
            "fields": BUCKET_FIELDS,
            "rows": rows,
            "accCurve": acc_curve,
            "typical": typical_profile([[pp for _, pp, _, _ in _plays(p)] for p in members]),
        })

    map_rows = []
    for map_id in ordered_ids:
        info = maps[map_id]
        scale = pp_scale.get(map_id)
        map_rows.append([info.id, info.hash, info.key, info.name, info.sub_name, info.artist, info.mapper,
                         info.difficulty, info.mode, round(info.stars, 2), info.cover,
                         global_count[map_id], round(global_weight[map_id], 3),
                         round(scale, 4) if scale else None, info.ranked_at, info.duration, info.tags,
                         info.njs, info.nps, info.mods])
    _dump(out_dir / "maps.json", {"fields": MAP_FIELDS, "rows": map_rows})

    shards: dict[int, dict] = defaultdict(dict)
    for player in players:
        shards[shard_of(player.id, shard_count)][player.id] = {
            "name": player.name,
            "country": player.country,
            "rank": player.rank,
            "pp": round(player.pp, 2),
            "scores": [[index[m], pp, acc] for m, pp, acc, _ in _plays(player)
                       if m in index][:SNAPSHOT_PLAYS],
        }
    for shard in range(shard_count):
        _dump(out_dir / "players" / f"{shard}.json",
              {"fields": SCORE_FIELDS, "players": shards.get(shard, {})})
    _dump(out_dir / "players" / "index.json", [[p.id, p.name, p.rank] for p in players])

    depths = [len(p.scores) for p in players]
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
        "medianPlays": statistics.median(depths) if depths else 0,
        "completeShare": round(sum(p.complete for p in players) / len(players), 3) if players else 0,
        "recentDays": RECENT_DAYS,
        "ppCurve": [[round(a, 5), round(v, 3)] for a, v in curve],
        "ppCurveFitted": curve_fitted,
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
