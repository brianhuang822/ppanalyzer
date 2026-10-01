"""Enrich maps from BeatSaver: key (for map pages and one-click installs), song length (for
pp-per-minute), tags (for style matching), note speed/density and required mods."""

from __future__ import annotations

import logging

from .http import HttpClient
from .models import MapInfo, normalize_key

log = logging.getLogger(__name__)

BASE_URL = "https://api.beatsaver.com"
BATCH_SIZE = 50
MOD_FLAGS = {"ne": "Noodle Extensions", "me": "Mapping Extensions"}


def _diff_for(doc: dict, map_hash: str, info: MapInfo) -> dict | None:
    """The BeatSaver difficulty entry matching this leaderboard (same version, mode, difficulty)."""
    versions = doc.get("versions") or []
    version = next((v for v in versions if str(v.get("hash", "")).lower() == map_hash), None)
    for diff in (version or (versions[0] if versions else {})).get("diffs") or []:
        if (str(diff.get("characteristic", "")).lower() == info.mode.lower()
                and str(diff.get("difficulty", "")).lower() == info.difficulty.lower()):
            return diff
    return None


def apply_doc(info: MapInfo, doc: dict, map_hash: str) -> None:
    key = normalize_key(doc.get("id"))
    if key and not info.key:
        info.key = key
    duration = (doc.get("metadata") or {}).get("duration")
    if duration:
        info.duration = float(duration)
    info.tags = [str(t) for t in doc.get("tags") or []]
    diff = _diff_for(doc, map_hash, info)
    if diff:
        info.njs = float(diff["njs"]) if diff.get("njs") is not None else None
        info.nps = round(float(diff["nps"]), 2) if diff.get("nps") is not None else None
        if diff.get("seconds"):
            info.duration = float(diff["seconds"])
        info.mods = [name for flag, name in MOD_FLAGS.items() if diff.get(flag)]


def enrich_maps(maps: dict[str, MapInfo], http: HttpClient | None = None) -> int:
    """Look every map up by hash. Returns how many were enriched; failures never abort."""
    by_hash: dict[str, list[MapInfo]] = {}
    for info in maps.values():
        if info.hash:
            by_hash.setdefault(info.hash.lower(), []).append(info)
    if not by_hash:
        return 0
    http = http or HttpClient(BASE_URL, rate_per_second=5.0)
    hashes = sorted(by_hash)
    enriched = 0
    for start in range(0, len(hashes), BATCH_SIZE):
        batch = hashes[start:start + BATCH_SIZE]
        try:
            body = http.get_json("maps/hash/" + ",".join(batch), allow_404=True)
        except Exception as exc:  # links degrade to a search link; never fail the build for this
            log.warning("BeatSaver lookup failed for %d hashes: %s", len(batch), exc)
            continue
        if not body:
            continue
        # One hash returns the map itself; several return {hash: map | null}.
        found = {batch[0]: body} if len(batch) == 1 and "id" in body else body
        for map_hash, doc in found.items():
            if not doc:
                continue
            for info in by_hash.get(map_hash.lower(), []):
                apply_doc(info, doc, map_hash.lower())
                enriched += 1
    return enriched
