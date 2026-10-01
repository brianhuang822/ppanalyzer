"""ScoreSaber API v2 (https://scoresaber.com/api/v2).

Endpoints used:
  GET /players?page&limit&sort=rank             ranked, active players (100 per page max)
  GET /players/{id}/scores?sort=top&limit=100   ranked plays by pp, each with its leaderboard
  GET /realms                                   realm list (name, decayFactor)
"""

from __future__ import annotations

from collections.abc import Iterator

from ..http import HttpClient
from ..models import (
    MapInfo,
    PlayerRecord,
    TopPlays,
    normalize_accuracy,
    normalize_difficulty,
    normalize_key,
    normalize_mode,
    parse_timestamp,
)

BASE_URL = "https://scoresaber.com/api/v2"
PAGE_SIZE = 100


def parse_leaderboard(board: dict) -> MapInfo | None:
    realm = board.get("realm") or {}
    if realm.get("leaderboardStatus", "RANKED") != "RANKED":
        return None
    song = board.get("map") or {}
    difficulty = board.get("difficulty") or {}
    diff_value = difficulty.get("difficulty")
    return MapInfo(
        id=str(board["id"]),
        hash=str(song.get("hash", "")).lower(),
        key=normalize_key(song.get("bsid")),
        name=song.get("songName", ""),
        sub_name=song.get("songSubName", "") or "",
        artist=song.get("songAuthorName", "") or "",
        mapper=song.get("levelAuthorName", "") or "",
        difficulty=normalize_difficulty(diff_value if isinstance(diff_value, int)
                                        else difficulty.get("rawDifficulty")),
        mode=normalize_mode(difficulty.get("gameMode")),
        stars=float(realm.get("stars") or 0.0),
        cover=song.get("coverUrl", "") or "",
        ranked_at=parse_timestamp(realm.get("rankedAt")) or None,
    )


def parse_score(item: dict) -> tuple[list, MapInfo, float] | None:
    score = item.get("score") or {}
    board = item.get("leaderboard") or {}
    pp = float(score.get("pp") or 0.0)
    if pp <= 0:
        return None
    info = parse_leaderboard(board)
    if info is None:
        return None
    max_score = board.get("maxScore") or 0
    fallback = (score.get("unmodifiedScore") or 0) / max_score if max_score else None
    acc = normalize_accuracy(score.get("accuracy"), fallback)
    row = [info.id, round(pp, 2), round(acc, 5), parse_timestamp(score.get("createdAt"))]
    return row, info, float(score.get("weight") or 0.0)


def parse_player(item: dict) -> PlayerRecord | None:
    stats = item.get("stats") or {}
    rank = stats.get("rank")
    if not rank or item.get("banned") or item.get("inactive"):
        return None
    return PlayerRecord(
        id=str(item["id"]),
        name=item.get("name", ""),
        country=item.get("country", "") or "",
        rank=int(rank),
        pp=float(stats.get("totalPP") or 0.0),
    )


class ScoreSaberSource:
    id = "scoresaber"
    label = "ScoreSaber"

    def __init__(self, http: HttpClient | None = None, realm_id: int | None = None):
        self.http = http or HttpClient(BASE_URL, rate_per_second=5.0)
        self.realm_id = realm_id
        self._realm_name: str | None = None

    def _params(self, **params) -> dict:
        if self.realm_id is not None:
            params["realmId"] = self.realm_id
        return params

    def iter_players(self, max_rank: int, min_rank: int = 1) -> Iterator[PlayerRecord]:
        # The ranking is sorted by rank, so jump straight to the page holding min_rank.
        page = max(1, (min_rank - 1) // PAGE_SIZE + 1)
        while True:
            body = self.http.get_json("players", self._params(page=page, limit=PAGE_SIZE, sort="rank",
                                                              sortDirection="asc"))
            data = body.get("data") or []
            for item in data:
                if self._realm_name is None:
                    self._realm_name = (item.get("stats") or {}).get("realmName")
                player = parse_player(item)
                if player is None or player.rank < min_rank:
                    continue
                if player.rank > max_rank:
                    return
                yield player
            meta = body.get("metadata") or {}
            if not data or page >= int(meta.get("totalPages") or page):
                return
            page += 1

    def fetch_top_scores(self, player_id: str, count: int) -> TopPlays:
        plays = TopPlays([], [], [], complete=False)
        # Keep the page size fixed: servers compute the offset as (page - 1) * limit.
        limit = min(PAGE_SIZE, count)
        page = 1
        while len(plays.rows) < count:
            body = self.http.get_json(f"players/{player_id}/scores",
                                      self._params(sort="top", limit=limit, page=page), allow_404=True)
            if not body:
                plays.complete = True
                break
            data = body.get("data") or []
            for item in data:
                if float((item.get("score") or {}).get("pp") or 0.0) <= 0:
                    # Plays are sorted by pp: the first 0pp play ends the ranked list.
                    plays.complete = True
                    return plays.truncated(count)
                parsed = parse_score(item)
                if parsed is None:
                    continue
                row, info, weight = parsed
                plays.rows.append(row)
                plays.maps.append(info)
                plays.weights.append(weight)
            meta = body.get("metadata") or {}
            if len(data) < limit or page >= int(meta.get("totalPages") or page):
                plays.complete = True
                break
            page += 1
        return plays.truncated(count)

    def realm_info(self) -> dict:
        info: dict = {"realm": self._realm_name}
        try:
            realms = self.http.get_json("realms") or []
        except Exception:  # realm metadata is nice-to-have, never fatal
            return info
        realm = None
        for candidate in realms:
            if self.realm_id is not None and candidate.get("id") == self.realm_id:
                realm = candidate
            elif self.realm_id is None and candidate.get("name") == self._realm_name:
                realm = candidate
        if realm:
            info["realm"] = realm.get("name")
            info["advertisedDecay"] = realm.get("decayFactor")
        return info
