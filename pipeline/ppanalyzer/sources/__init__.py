"""Leaderboard sources. Each source turns API responses into ``PlayerRecord`` / ``MapInfo``."""

from __future__ import annotations

import statistics
from collections.abc import Iterator
from typing import Protocol

from ..models import PlayerRecord, TopPlays

DEFAULT_DECAY = 0.965


class Source(Protocol):
    id: str
    label: str

    def iter_players(self, max_rank: int, min_rank: int = 1) -> Iterator[PlayerRecord]:
        """Yield ranked players ranked min_rank..max_rank in rank order (scores left empty)."""

    def fetch_top_scores(self, player_id: str, count: int) -> TopPlays:
        """A player's best ``count`` ranked plays (all of them when they have fewer)."""

    def realm_info(self) -> dict:
        """Extra metadata about the leaderboard (realm name, advertised decay, ...)."""


def estimate_decay(weight_lists: list[list[float]], advertised: float | None = None) -> float:
    """pp weighting decay (0.965 on both sites today), measured from the ``weight`` the API
    reports for each top play: weight[i + 1] / weight[i] is the decay factor."""
    ratios = []
    for weights in weight_lists:
        for first, second in zip(weights, weights[1:], strict=False):
            if first > 0 and second > 0:
                ratio = second / first
                if 0.5 < ratio < 1.0:
                    ratios.append(ratio)
    if len(ratios) >= 5:
        return round(statistics.median(ratios), 6)
    if advertised is not None:
        if 0.5 < advertised < 1.0:
            return advertised
        if 0.0 < advertised < 0.5:
            return round(1.0 - advertised, 6)
    return DEFAULT_DECAY
