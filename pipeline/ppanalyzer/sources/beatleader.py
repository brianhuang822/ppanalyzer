"""BeatLeader API (https://api.beatleader.com).

Endpoints used:
  GET /players?page&count&sortBy=pp&order=desc                      ranking (10 req / 10 s)
  GET /player/{id}/scores?sortBy=pp&order=desc&count=100&type=ranked top plays (50 req / 10 s)
"""

from __future__ import annotations

from collections.abc import Iterator

from ..http import HttpClient
from ..models import (
    MapInfo,
    PlayerRecord,
    normalize_accuracy,
    normalize_difficulty,
    normalize_key,
    normalize_mode,
)

BASE_URL = "https://api.beatleader.com"
PAGE_SIZE = 100
RANKED_STATUS = 3  # DifficultyStatus.ranked


def parse_leaderboard(board: dict) -> MapInfo | None:
    song = board.get("song") or {}
    difficulty = board.get("difficulty") or {}
    status = difficulty.get("status")
    if status is not None and status not in (RANKED_STATUS, "ranked", "Ranked"):
        return None
    return MapInfo(
        id=str(board.get("id")),
        hash=str(song.get("hash", "")).lower(),
        # BeatLeader song ids are BeatSaver keys, sometimes with a non-hex suffix for
        # re-uploads; those are dropped here and resolved through BeatSaver by hash.
        key=normalize_key(song.get("id")),
        name=song.get("name", "") or "",
        sub_name=song.get("subName", "") or "",
        artist=song.get("author", "") or "",
        mapper=song.get("mapper", "") or "",
        difficulty=normalize_difficulty(difficulty.get("difficultyName")),
        mode=normalize_mode(difficulty.get("modeName")),
        stars=float(difficulty.get("stars") or 0.0),
        cover=song.get("coverImage", "") or "",
    )


def parse_score(item: dict) -> tuple[list, MapInfo, float] | None:
    pp = float(item.get("pp") or 0.0)
    if pp <= 0:
        return None
    board = item.get("leaderboard") or {}
    if "id" not in board and item.get("leaderboardId"):
        board = {**board, "id": item["leaderboardId"]}
    info = parse_leaderboard(board)
    if info is None:
        return None
    acc = normalize_accuracy(item.get("accuracy"))
    return [info.id, round(pp, 2), round(acc, 5)], info, float(item.get("weight") or 0.0)


def parse_player(item: dict) -> PlayerRecord | None:
    rank = item.get("rank")
    if not rank or item.get("bot") or item.get("banned"):
        return None
    return PlayerRecord(
        id=str(item["id"]),
        name=item.get("name", "") or "",
        country=item.get("country", "") or "",
        rank=int(rank),
        pp=float(item.get("pp") or 0.0),
    )


class BeatLeaderSource:
    id = "beatleader"
    label = "BeatLeader"

    def __init__(self, http: HttpClient | None = None, players_http: HttpClient | None = None):
        # /players has its own, stricter limit (10 per 10 s) than the general 50 per 10 s.
        self.http = http or HttpClient(BASE_URL, rate_per_second=4.0)
        self.players_http = players_http or HttpClient(BASE_URL, rate_per_second=0.9)

    def iter_players(self, max_rank: int) -> Iterator[PlayerRecord]:
        page = 1
        while True:
            body = self.players_http.get_json("players", {"page": page, "count": PAGE_SIZE,
                                                          "sortBy": "pp", "order": "desc"})
            data = body.get("data") or []
            for item in data:
                player = parse_player(item)
                if player is None:
                    continue
                if player.rank > max_rank:
                    return
                yield player
            meta = body.get("metadata") or {}
            total = int(meta.get("total") or 0)
            if not data or page * PAGE_SIZE >= total:
                return
            page += 1

    def fetch_top_scores(self, player_id: str, count: int) -> tuple[list[list], list[MapInfo], list[float]]:
        rows: list[list] = []
        maps: list[MapInfo] = []
        weights: list[float] = []
        # Keep the page size fixed: servers compute the offset as (page - 1) * limit.
        limit = min(PAGE_SIZE, count)
        page = 1
        while len(rows) < count:
            body = self.http.get_json(f"player/{player_id}/scores",
                                      {"sortBy": "pp", "order": "desc", "count": limit, "page": page,
                                       "type": "ranked"}, allow_404=True)
            if not body:
                break
            data = body.get("data") or []
            for item in data:
                if float(item.get("pp") or 0.0) <= 0:
                    # Top plays are sorted by pp: the first 0pp play ends the ranked list.
                    return rows, maps, weights
                parsed = parse_score(item)
                if parsed is None:
                    continue
                row, info, weight = parsed
                rows.append(row)
                maps.append(info)
                weights.append(weight)
            if len(data) < limit:
                break
            page += 1
        return rows[:count], maps[:count], weights[:count]

    def realm_info(self) -> dict:
        return {"realm": "General"}
