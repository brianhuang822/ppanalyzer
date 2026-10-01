"""Fetch a raw snapshot: ranked players plus their ranked plays.

Output directory layout (everything append-only so an interrupted run can resume):
  players.jsonl       one PlayerRecord per line
  leaderboards.jsonl  one MapInfo per line (deduplicated on load)
  meta.json           source, timings, decay, realm

Large snapshots are fetched in rank-range parts (``min_rank``/``max_rank``) on parallel
machines and combined with ``merge_snapshots``.
"""

from __future__ import annotations

import json
import logging
import statistics
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import UTC, datetime
from pathlib import Path

from .beatsaver import enrich_maps
from .models import MapInfo, PlayerRecord
from .sources import Source, estimate_decay

log = logging.getLogger(__name__)

WEIGHT_SAMPLE_PLAYERS = 50


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_players(path: Path) -> list[PlayerRecord]:
    if not path.exists():
        return []
    players = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                players.append(PlayerRecord.from_json(json.loads(line)))
    return players


def load_maps(path: Path) -> dict[str, MapInfo]:
    maps: dict[str, MapInfo] = {}
    if not path.exists():
        return maps
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                info = MapInfo.from_json(json.loads(line))
                maps[info.id] = info
    return maps


def write_maps(path: Path, maps: dict[str, MapInfo]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for info in maps.values():
            fh.write(json.dumps(info.to_json(), ensure_ascii=False) + "\n")


def fetch_snapshot(source: Source, out_dir: Path, max_rank: int, scores_per_player: int,
                   workers: int = 4, min_rank: int = 1) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    players_path = out_dir / "players.jsonl"
    maps_path = out_dir / "leaderboards.jsonl"
    meta_path = out_dir / "meta.json"

    previous_meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    done = {p.id for p in load_players(players_path)}
    known_maps = load_maps(maps_path)
    started = previous_meta.get("fetchStartedAt") or now_iso()
    if done:
        log.info("resuming: %d players already fetched", len(done))

    log.info("listing %s players ranked %d-%d", source.label, min_rank, max_rank)
    roster = list(source.iter_players(max_rank, min_rank))
    todo = [p for p in roster if p.id not in done]
    log.info("%d players in range, %d to fetch", len(roster), len(todo))

    weight_samples: list[list[float]] = list(previous_meta.get("weightSamples", []))
    failures: list[str] = []
    fetched = 0
    t0 = time.monotonic()

    with players_path.open("a", encoding="utf-8") as players_fh, \
            maps_path.open("a", encoding="utf-8") as maps_fh, \
            ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        pending = {}
        queue = iter(todo)

        def submit_next() -> bool:
            player = next(queue, None)
            if player is None:
                return False
            pending[pool.submit(source.fetch_top_scores, player.id, scores_per_player)] = player
            return True

        for _ in range(max(1, workers) * 2):
            if not submit_next():
                break
        while pending:
            finished, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in finished:
                player = pending.pop(future)
                try:
                    plays = future.result()
                except Exception as exc:
                    log.error("giving up on player %s (rank %d): %s", player.id, player.rank, exc)
                    failures.append(player.id)
                else:
                    player.scores = plays.rows
                    player.complete = plays.complete
                    players_fh.write(json.dumps(player.to_json(), ensure_ascii=False) + "\n")
                    for info in plays.maps:
                        if info.id not in known_maps:
                            known_maps[info.id] = info
                            maps_fh.write(json.dumps(info.to_json(), ensure_ascii=False) + "\n")
                    if len(weight_samples) < WEIGHT_SAMPLE_PLAYERS and len(plays.weights) > 1:
                        weight_samples.append(plays.weights[:20])
                    fetched += 1
                    if fetched % 250 == 0:
                        rate = fetched / max(1e-9, time.monotonic() - t0)
                        log.info("%d/%d players (%.1f/s)", fetched, len(todo), rate)
                        players_fh.flush()
                        maps_fh.flush()
                submit_next()

    if failures and len(failures) > max(10, len(todo) // 20):
        raise RuntimeError(f"{len(failures)} of {len(todo)} players failed; not writing meta")

    realm = source.realm_info()
    meta = {
        "source": source.id,
        "label": source.label,
        "realm": realm.get("realm"),
        "decay": estimate_decay(weight_samples, realm.get("advertisedDecay")),
        "minRank": min_rank,
        "maxRank": max_rank,
        "scoresPerPlayer": scores_per_player,
        "playerCount": len(done) + fetched,
        "mapCount": len(known_maps),
        "failedPlayers": failures,
        "fetchStartedAt": started,
        "fetchedAt": now_iso(),
        "weightSamples": weight_samples,
    }
    meta_path.write_text(json.dumps(meta, indent=1))
    log.info("done: %d players, %d maps, decay %.4f", meta["playerCount"], meta["mapCount"], meta["decay"])
    return meta


def merge_snapshots(parts: list[Path], out_dir: Path) -> dict:
    """Combine rank-range parts fetched separately into one snapshot."""
    if not parts:
        raise ValueError("nothing to merge")
    metas = [json.loads((part / "meta.json").read_text()) for part in parts]
    players: dict[str, PlayerRecord] = {}
    maps: dict[str, MapInfo] = {}
    for part in parts:
        for player in load_players(part / "players.jsonl"):
            # Ranks shift while parts run; a player seen twice keeps the better rank.
            if player.id not in players or player.rank < players[player.id].rank:
                players[player.id] = player
        for map_id, info in load_maps(part / "leaderboards.jsonl").items():
            if map_id not in maps or (info.key and not maps[map_id].key):
                maps[map_id] = info

    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "players.jsonl").open("w", encoding="utf-8") as fh:
        for player in sorted(players.values(), key=lambda p: p.rank):
            fh.write(json.dumps(player.to_json(), ensure_ascii=False) + "\n")
    write_maps(out_dir / "leaderboards.jsonl", maps)

    samples = [w for m in metas for w in m.get("weightSamples", [])]
    decays = [m["decay"] for m in metas if m.get("decay")]
    meta = {
        **metas[0],
        "decay": estimate_decay(samples, statistics.median(decays) if decays else None),
        "minRank": min(m.get("minRank", 1) for m in metas),
        "maxRank": max(m.get("maxRank", 0) for m in metas),
        "playerCount": len(players),
        "mapCount": len(maps),
        "failedPlayers": [f for m in metas for f in m.get("failedPlayers", [])],
        "fetchStartedAt": min(m.get("fetchStartedAt", "") for m in metas),
        "fetchedAt": max(m.get("fetchedAt", "") for m in metas),
        "weightSamples": samples[:WEIGHT_SAMPLE_PLAYERS],
        "parts": len(parts),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=1))
    return meta


def enrich_snapshot(raw_dir: Path) -> int:
    """Add BeatSaver metadata to a snapshot's maps in place."""
    maps = load_maps(raw_dir / "leaderboards.jsonl")
    enriched = enrich_maps(maps)
    write_maps(raw_dir / "leaderboards.jsonl", maps)
    meta_path = raw_dir / "meta.json"
    meta = json.loads(meta_path.read_text())
    meta["enrichedMaps"] = enriched
    meta_path.write_text(json.dumps(meta, indent=1))
    log.info("BeatSaver metadata for %d of %d maps", enriched, len(maps))
    return enriched
