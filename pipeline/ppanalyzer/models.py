"""Source-agnostic records written to the raw snapshot."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime

HEX_KEY = re.compile(r"^[0-9a-f]+$")

# ScoreSaber encodes difficulties as odd numbers.
DIFFICULTY_BY_NUMBER = {1: "Easy", 3: "Normal", 5: "Hard", 7: "Expert", 9: "ExpertPlus"}
DIFFICULTIES = ("Easy", "Normal", "Hard", "Expert", "ExpertPlus")


@dataclass
class MapInfo:
    """One ranked leaderboard (a song + difficulty + characteristic)."""

    id: str
    hash: str
    key: str | None
    name: str
    sub_name: str
    artist: str
    mapper: str
    difficulty: str
    mode: str
    stars: float
    cover: str
    # Unix seconds; lets the app flag newly ranked maps (few players have farmed them yet).
    ranked_at: int | None = None
    # From BeatSaver (see beatsaver.enrich_maps).
    duration: float | None = None
    tags: list[str] = field(default_factory=list)
    njs: float | None = None
    nps: float | None = None
    mods: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> MapInfo:
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class PlayerRecord:
    """A ranked player and their ranked plays, best first.

    ``scores`` rows are ``[leaderboard_id, pp, accuracy, set_at]``: accuracy in 0..1, set_at in
    unix seconds (0 when unknown; older snapshots have 3-item rows). ``complete`` means every
    ranked play was fetched, so a missing map really was never played, not just played badly.
    """

    id: str
    name: str
    country: str
    rank: int
    pp: float
    scores: list[list] = field(default_factory=list)
    complete: bool = False

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> PlayerRecord:
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class TopPlays:
    """One player's ranked plays as returned by a source."""

    rows: list[list]
    maps: list[MapInfo]
    weights: list[float]
    complete: bool

    def truncated(self, count: int) -> TopPlays:
        """At most ``count`` plays; cutting any off means the list is no longer complete."""
        complete = self.complete and len(self.rows) <= count
        return TopPlays(self.rows[:count], self.maps[:count], self.weights[:count], complete)


def parse_timestamp(value: object) -> int:
    """Unix seconds from an ISO 8601 string, a number, or a numeric string; 0 if unknown."""
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        seconds = float(value)
    else:
        text = str(value).strip()
        try:
            seconds = float(text)
        except ValueError:
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return 0
            if parsed.tzinfo is None:
                return 0
            return int(parsed.timestamp())
    if seconds > 1e12:  # milliseconds
        seconds /= 1000.0
    return int(seconds) if seconds > 0 else 0


def normalize_key(value: object) -> str | None:
    """BeatSaver keys are short lowercase hex strings; anything else is unusable for links."""
    if value is None:
        return None
    key = str(value).strip().lower()
    return key if key and HEX_KEY.match(key) else None


def normalize_accuracy(value: object, fallback: float | None = None) -> float:
    """Return accuracy in 0..1 whether the API reports a fraction or a percentage."""
    try:
        acc = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        acc = 0.0
    if acc > 1.5:
        acc /= 100.0
    if acc <= 0 and fallback is not None:
        acc = fallback
    return max(0.0, min(acc, 1.0))


def normalize_mode(value: str | None) -> str:
    mode = (value or "Standard").strip()
    if mode.startswith("Solo"):
        mode = mode[len("Solo"):]
    return mode or "Standard"


def normalize_difficulty(value: str | int | None) -> str:
    if isinstance(value, int):
        return DIFFICULTY_BY_NUMBER.get(value, "ExpertPlus")
    text = str(value or "").strip()
    # ScoreSaber raw difficulty looks like "_ExpertPlus_SoloStandard".
    if text.startswith("_"):
        text = text.split("_")[1]
    for name in DIFFICULTIES:
        if text.lower() == name.lower():
            return name
    if text.lower() in ("expert+", "expertplus"):
        return "ExpertPlus"
    return text or "ExpertPlus"
