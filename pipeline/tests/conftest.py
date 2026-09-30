from __future__ import annotations

import pytest

from ppanalyzer.http import HttpClient


def ss_leaderboard(board_id: int, stars: float = 8.5, status: str = "RANKED", bsid: str | None = "2a1b",
                   difficulty: int = 9, game_mode: str = "SoloStandard") -> dict:
    """A leaderboard object shaped like ScoreSaber API v2."""
    return {
        "id": board_id,
        "map": {
            "id": board_id * 10,
            "hash": f"{board_id:040X}",
            "bsid": bsid,
            "songName": f"Song {board_id}",
            "songSubName": "",
            "songAuthorName": f"Artist {board_id}",
            "levelAuthorName": f"Mapper {board_id}",
            "bpm": 180,
            "coverUrl": f"https://cdn.scoresaber.com/covers/{board_id:040X}.png",
            "verified": True,
        },
        "difficulty": {"id": board_id, "difficulty": difficulty,
                       "rawDifficulty": "_ExpertPlus_SoloStandard", "gameMode": game_mode},
        "maxScore": 1_000_000,
        "totalScores": 1000,
        "dailyScores": 5,
        "createdAt": "2025-01-01T00:00:00Z",
        "realm": {"realmId": 1, "realmName": "Main", "leaderboardStatus": status, "positiveModifiers": False,
                  "stars": stars, "rankedAt": "2025-01-02T00:00:00Z", "qualifiedAt": None, "lovedAt": None},
    }


def ss_score(board_id: int, pp: float, accuracy: float = 95.5, weight: float = 1.0, **board_kwargs) -> dict:
    return {
        "score": {"id": board_id * 7, "rank": 12, "unmodifiedScore": 955_000, "modifiedScore": 955_000,
                  "accuracy": accuracy, "pp": pp, "weight": weight, "mods": [], "badCuts": 0,
                  "missedNotes": 0, "maxCombo": 900, "fullCombo": True, "hasReplay": True,
                  "personalBest": True, "createdAt": "2025-03-01T00:00:00Z"},
        "leaderboard": ss_leaderboard(board_id, **board_kwargs),
    }


def ss_player(player_id: str, rank: int, pp: float = 10000.0, **extra) -> dict:
    return {
        "id": player_id, "name": f"Player {rank}", "playerNameInGame": f"Player {rank}", "country": "US",
        "role": None, "avatar": "", "permissions": 0, "banned": False, "silenced": False, "inactive": False,
        "stats": {"realmId": 1, "realmName": "Main", "rank": rank, "countryRank": rank, "totalPP": pp},
        **extra,
    }


def page(data: list, page_number: int, total_pages: int, per_page: int = 100) -> dict:
    return {"data": data, "metadata": {"page": page_number, "itemsPerPage": per_page,
                                       "totalItems": total_pages * per_page, "totalPages": total_pages}}


def bl_score(lb_id: str, pp: float, accuracy: float = 0.955, weight: float = 1.0,
             song_id: str = "3c4d", status: int = 3, stars: float = 9.1) -> dict:
    """A score shaped like BeatLeader's ScoreResponseWithMyScore."""
    return {
        "id": 1, "accuracy": accuracy, "pp": pp, "weight": weight, "rank": 3, "leaderboardId": lb_id,
        "leaderboard": {
            "id": lb_id,
            "song": {"id": song_id, "hash": "ABCDEF0123456789ABCDEF0123456789ABCDEF01", "name": f"BL {lb_id}",
                     "subName": "", "author": "Artist", "mapper": "Mapper", "coverImage": "https://img/x.jpg"},
            "difficulty": {"stars": stars, "difficultyName": "Expert", "modeName": "Standard",
                           "status": status},
        },
    }


@pytest.fixture
def no_sleep_client():
    def make(base_url: str, **kwargs) -> HttpClient:
        kwargs.setdefault("rate_per_second", 0)
        return HttpClient(base_url, sleep=lambda _s: None, **kwargs)

    return make
