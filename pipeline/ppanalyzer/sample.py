"""Deterministic synthetic snapshot for local development, CI and end-to-end tests.

It is obviously fake (songs are called "Sample Song 042") and the site shows a banner when
serving it. It uses ScoreSaber's pp formula and plants a known set of overweighted maps
(players score unusually well on them for their star rating), so tests can check that the
model finds them.
"""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

from .fetch import now_iso
from .model import DEFAULT_CURVE, PP_PER_STAR, interpolate
from .models import DIFFICULTIES, MapInfo, PlayerRecord, parse_timestamp

DECAY = 0.965
TAGS = ["tech", "speed", "accuracy", "balanced", "dance-style", "challenge", "fitness"]
OVERWEIGHT_SHARE = 0.12
OVERWEIGHT_BONUS = 0.012  # +1.2% accuracy over what the stars imply


def sample_pp(stars: float, acc: float) -> float:
    return PP_PER_STAR * stars * interpolate(DEFAULT_CURVE, acc)


def generate_sample(out_dir: Path, players: int = 3000, maps: int = 600, scores_per_player: int = 300,
                    seed: int = 7, fetched_at: str | None = None) -> dict:
    rng = random.Random(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    fetched_at = fetched_at or now_iso()
    now = parse_timestamp(fetched_at)

    map_list: list[MapInfo] = []
    bonus: dict[str, float] = {}
    tag_bonus = {tag: rng.uniform(-0.003, 0.003) for tag in TAGS}
    for i in range(maps):
        digest = hashlib.sha1(f"sample-map-{i}".encode()).hexdigest()
        stars = round(min(14.0, max(1.0, rng.gauss(7.0, 3.0))), 2)
        tags = rng.sample(TAGS, k=rng.randint(1, 3))
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
            ranked_at=now - rng.randint(1, 1500) * 86400,
            duration=float(rng.randint(90, 330)),
            tags=tags,
            njs=float(rng.choice([14, 16, 18, 20, 22])),
            nps=round(stars * 0.6 + rng.uniform(0.5, 2.0), 2),
        )
        map_list.append(info)
        bonus[info.id] = OVERWEIGHT_BONUS if rng.random() < OVERWEIGHT_SHARE else 0.0

    records: list[tuple[float, PlayerRecord]] = []
    for p in range(players):
        skill = 13.5 - 10.5 * ((p + 0.5) / players) ** 0.6 + rng.gauss(0, 0.3)
        candidates = [m for m in map_list if m.stars <= skill + 1.0]
        # Overweighted maps get played more: the community finds them.
        weights = [2.0 if bonus[m.id] else 1.0 for m in candidates]
        played = {m.id for m in rng.choices(candidates, weights=weights, k=min(len(candidates), 260))}
        by_id = {m.id: m for m in candidates}
        plays = []
        for map_id in played:
            m = by_id[map_id]
            style = sum(tag_bonus[t] for t in m.tags)
            acc = 0.985 - 0.02 * max(0.0, m.stars - skill + 3.0) + bonus[map_id] + style + rng.gauss(0, 0.004)
            acc = max(0.62, min(0.995, acc))
            pp = sample_pp(m.stars, acc)
            if pp > 0:
                set_at = now - int(rng.expovariate(1 / (60 * 86400)))
                plays.append([map_id, round(pp, 2), round(acc, 5), set_at])
        plays.sort(key=lambda r: -r[1])
        complete = len(plays) <= scores_per_player
        plays = plays[:scores_per_player]
        total = sum(row[1] * DECAY ** i for i, row in enumerate(plays))
        player_id = str(76561198000000000 + p * 7919)
        records.append((total, PlayerRecord(id=player_id, name=f"Sample Player {p:05d}", country="",
                                            rank=0, pp=round(total, 2), scores=plays, complete=complete)))

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
        "minRank": 1,
        "maxRank": players,
        "scoresPerPlayer": scores_per_player,
        "playerCount": players,
        "mapCount": maps,
        "fetchedAt": fetched_at,
        # Ground truth for tests: the maps that really are overweighted.
        "plantedOverweight": sorted(m for m, b in bonus.items() if b),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=1))
    return meta
