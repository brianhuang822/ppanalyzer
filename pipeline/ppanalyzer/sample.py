"""Deterministic synthetic snapshot for local development, CI and end-to-end tests.

It is obviously fake (songs are called "Sample Song 042") and the site shows a banner when
serving it. The shape matches a real snapshot, so every code path gets exercised.
"""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

from .fetch import now_iso
from .models import DIFFICULTIES, MapInfo, PlayerRecord

DECAY = 0.965


def _curve(acc: float) -> float:
    """Rough stand-in for a pp curve: steep near the top, flat below 80%."""
    if acc <= 0.6:
        return 0.0
    return ((acc - 0.6) / 0.4) ** 2.6 * 1.25


def generate_sample(out_dir: Path, players: int = 3000, maps: int = 600, scores_per_player: int = 100,
                    seed: int = 7) -> dict:
    rng = random.Random(seed)
    out_dir.mkdir(parents=True, exist_ok=True)

    map_list: list[MapInfo] = []
    farm_bonus: dict[str, float] = {}
    for i in range(maps):
        digest = hashlib.sha1(f"sample-map-{i}".encode()).hexdigest()
        stars = round(min(14.0, max(1.0, rng.gauss(7.0, 3.0))), 2)
        info = MapInfo(
            id=str(100000 + i),
            hash=digest,
            key=None,  # never point sample rows at real BeatSaver maps
            name=f"Sample Song {i:03d}",
            sub_name="",
            artist=f"Sample Artist {i % 97:02d}",
            mapper=f"Mapper {i % 41:02d}",
            difficulty=DIFFICULTIES[min(4, 2 + int(stars // 4))],
            mode="Standard",
            stars=stars,
            cover="",
        )
        map_list.append(info)
        # A few maps are "pp maps": easy to score well on for their star rating.
        farm_bonus[info.id] = 0.015 if rng.random() < 0.12 else rng.uniform(-0.01, 0.004)

    records: list[tuple[float, PlayerRecord]] = []
    for p in range(players):
        skill = 13.5 - 10.5 * ((p + 0.5) / players) ** 0.6 + rng.gauss(0, 0.3)
        candidates = [m for m in map_list if m.stars <= skill + 1.0]
        weights = [3.0 if farm_bonus[m.id] > 0.01 else 1.0 for m in candidates]
        played = set()
        for m in rng.choices(candidates, weights=weights, k=min(len(candidates), 220)):
            played.add(m.id)
        by_id = {m.id: m for m in candidates}
        plays = []
        for map_id in played:
            m = by_id[map_id]
            acc = 0.985 - 0.02 * max(0.0, m.stars - skill + 3.0) + farm_bonus[map_id] + rng.gauss(0, 0.006)
            acc = max(0.62, min(0.995, acc))
            pp = m.stars * 42.0 * _curve(acc)
            if pp > 0:
                plays.append([map_id, round(pp, 2), round(acc, 5)])
        plays.sort(key=lambda r: -r[1])
        plays = plays[:scores_per_player]
        total = sum(row[1] * DECAY ** i for i, row in enumerate(plays))
        player_id = str(76561198000000000 + p * 7919)
        records.append((total, PlayerRecord(id=player_id, name=f"Sample Player {p:05d}", country="",
                                            rank=0, pp=round(total, 2), scores=plays)))

    records.sort(key=lambda r: -r[0])
    with (out_dir / "players.jsonl").open("w", encoding="utf-8") as fh:
        for rank, (_, record) in enumerate(records, start=1):
            record.rank = rank
            fh.write(json.dumps(record.to_json()) + "\n")
    with (out_dir / "leaderboards.jsonl").open("w", encoding="utf-8") as fh:
        for info in map_list:
            fh.write(json.dumps(info.to_json()) + "\n")

    meta = {
        "source": "sample",
        "label": "Sample",
        "realm": None,
        "sample": True,
        "decay": DECAY,
        "maxRank": players,
        "scoresPerPlayer": scores_per_player,
        "playerCount": players,
        "mapCount": maps,
        "fetchedAt": now_iso(),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=1))
    return meta
