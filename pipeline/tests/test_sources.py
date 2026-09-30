import pytest
import responses
from conftest import bl_score, page, ss_player, ss_score
from responses import matchers

from ppanalyzer.sources import estimate_decay
from ppanalyzer.sources.beatleader import BASE_URL as BL
from ppanalyzer.sources.beatleader import BeatLeaderSource
from ppanalyzer.sources.scoresaber import BASE_URL as SS
from ppanalyzer.sources.scoresaber import ScoreSaberSource


@responses.activate
def test_scoresaber_players_paginate_and_stop_at_max_rank(no_sleep_client):
    responses.get(f"{SS}/players", match=[matchers.query_param_matcher(
        {"page": "1", "limit": "100", "sort": "rank", "sortDirection": "asc"})],
        json=page([ss_player("1", 1), ss_player("2", 2, banned=True), ss_player("3", 3)], 1, 2))
    responses.get(f"{SS}/players", match=[matchers.query_param_matcher(
        {"page": "2", "limit": "100", "sort": "rank", "sortDirection": "asc"})],
        json=page([ss_player("4", 4), ss_player("5", 5)], 2, 2))
    source = ScoreSaberSource(no_sleep_client(SS))
    assert [p.id for p in source.iter_players(max_rank=4)] == ["1", "3", "4"]
    player = next(iter(source.iter_players(max_rank=1)))
    assert (player.name, player.rank, player.pp, player.country) == ("Player 1", 1, 10000.0, "US")


@responses.activate
def test_scoresaber_top_scores(no_sleep_client):
    responses.get(f"{SS}/players/42/scores", json=page([
        ss_score(1, 400.5, accuracy=96.1, weight=1.0),
        ss_score(2, 390.0, accuracy=0.95, weight=0.965, status="QUALIFIED"),  # skipped: not ranked
        ss_score(3, 380.0, weight=0.931225, bsid=None, difficulty=7, game_mode="SoloOneSaber"),
        ss_score(4, 0.0),  # first unranked play ends the list
        ss_score(5, 0.0),
    ], 1, 1))
    rows, maps, weights = ScoreSaberSource(no_sleep_client(SS)).fetch_top_scores("42", 100)
    assert rows == [["1", 400.5, 0.961], ["3", 380.0, 0.955]]
    assert weights == [1.0, 0.931225]
    first, third = maps
    assert first.key == "2a1b" and first.difficulty == "ExpertPlus" and first.mode == "Standard"
    assert first.hash == f"{1:040x}" and first.stars == 8.5
    assert third.key is None and third.difficulty == "Expert" and third.mode == "OneSaber"
    request = responses.calls[0].request
    assert "sort=top" in request.url and "limit=100" in request.url


@responses.activate
def test_scoresaber_top_scores_paginates_beyond_100(no_sleep_client):
    responses.get(f"{SS}/players/7/scores", match=[matchers.query_param_matcher(
        {"sort": "top", "limit": "100", "page": "1"})],
        json=page([ss_score(i, 500 - i) for i in range(1, 101)], 1, 3))
    responses.get(f"{SS}/players/7/scores", match=[matchers.query_param_matcher(
        {"sort": "top", "limit": "100", "page": "2"})],
        json=page([ss_score(i, 500 - i) for i in range(101, 201)], 2, 3))
    rows, _, _ = ScoreSaberSource(no_sleep_client(SS)).fetch_top_scores("7", 120)
    assert len(rows) == 120 and rows[-1][0] == "120"


@responses.activate
def test_scoresaber_missing_player_returns_empty(no_sleep_client):
    responses.get(f"{SS}/players/404/scores", status=404)
    assert ScoreSaberSource(no_sleep_client(SS)).fetch_top_scores("404", 100) == ([], [], [])


@responses.activate
def test_scoresaber_realm_info(no_sleep_client):
    responses.get(f"{SS}/players", json=page([ss_player("1", 1)], 1, 1))
    responses.get(f"{SS}/realms", json=[
        {"id": 0, "name": "Legacy", "decayFactor": 0.9, "isAcceptingScores": False, "hasPP": True},
        {"id": 1, "name": "Main", "decayFactor": 0.965, "isAcceptingScores": True, "hasPP": True},
    ])
    source = ScoreSaberSource(no_sleep_client(SS))
    list(source.iter_players(10))
    assert source.realm_info() == {"realm": "Main", "advertisedDecay": 0.965}


@responses.activate
def test_beatleader_players_and_scores(no_sleep_client):
    responses.get(f"{BL}/players", json={"metadata": {"itemsPerPage": 100, "page": 1, "total": 2}, "data": [
        {"id": "9", "name": "A", "country": "DE", "rank": 1, "pp": 20000, "bot": False},
        {"id": "8", "name": "Bot", "country": "", "rank": 2, "pp": 19000, "bot": True},
    ]})
    responses.get(f"{BL}/player/9/scores", json={"metadata": {"total": 3}, "data": [
        bl_score("abc91", 500.0, weight=1.0),
        bl_score("def61", 480.0, song_id="7c44x", weight=0.965),
        bl_score("ghi31", 470.0, status=2),
        bl_score("jkl11", 0.0),
    ]})
    client = no_sleep_client(BL)
    source = BeatLeaderSource(client, players_http=client)
    assert [p.id for p in source.iter_players(100)] == ["9"]
    rows, maps, weights = source.fetch_top_scores("9", 100)
    assert rows == [["abc91", 500.0, 0.955], ["def61", 480.0, 0.955]]
    assert maps[0].key == "3c4d" and maps[1].key is None  # non-hex id resolved later via BeatSaver
    assert maps[0].hash == "abcdef0123456789abcdef0123456789abcdef01"
    assert maps[0].difficulty == "Expert" and maps[0].stars == 9.1
    assert weights == [1.0, 0.965]
    url = responses.calls[-1].request.url
    assert "sortBy=pp" in url and "type=ranked" in url and "count=100" in url


@pytest.mark.parametrize("weights, advertised, expected", [
    ([[1.0, 0.965, 0.931225, 0.898632, 0.867180, 0.836829]], None, 0.965),
    ([[1.0]], 0.035, 0.965),
    ([[1.0]], 0.97, 0.97),
    ([], None, 0.965),
])
def test_estimate_decay(weights, advertised, expected):
    assert estimate_decay(weights, advertised) == pytest.approx(expected, abs=1e-4)
