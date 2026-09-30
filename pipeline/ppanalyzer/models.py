"""Source-agnostic records written to the raw snapshot."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

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

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> MapInfo:
        return cls(**data)


@dataclass
class PlayerRecord:
    """A ranked player and their top ranked plays, best first.

    ``scores`` rows are ``[leaderboard_id, pp, accuracy]`` with accuracy in 0..1.
    """

    id: str
    name: str
    country: str
    rank: int
    pp: float
    scores: list[list] = field(default_factory=list)

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> PlayerRecord:
        return cls(**data)


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
