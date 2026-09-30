"""Resolve BeatSaver keys (needed for map pages and one-click installs) from map hashes."""

from __future__ import annotations

import logging

from .http import HttpClient
from .models import MapInfo, normalize_key

log = logging.getLogger(__name__)

BASE_URL = "https://api.beatsaver.com"
BATCH_SIZE = 50


def resolve_keys(maps: dict[str, MapInfo], http: HttpClient | None = None) -> int:
    """Fill ``MapInfo.key`` for maps that lack one. Returns how many were resolved."""
    missing: dict[str, list[MapInfo]] = {}
    for info in maps.values():
        if not info.key and info.hash:
            missing.setdefault(info.hash.lower(), []).append(info)
    if not missing:
        return 0
    http = http or HttpClient(BASE_URL, rate_per_second=5.0)
    hashes = sorted(missing)
    resolved = 0
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
            key = normalize_key((doc or {}).get("id"))
            if not key:
                continue
            for info in missing.get(map_hash.lower(), []):
                info.key = key
                resolved += 1
    return resolved
