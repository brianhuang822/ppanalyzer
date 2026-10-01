"""Command line entry point: ``python -m ppanalyzer <command>``."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .build import build_site_data, write_sources_index
from .fetch import enrich_snapshot, fetch_snapshot, merge_snapshots
from .http import HttpClient
from .sample import generate_sample


def make_source(name: str, rate: float):
    if name == "scoresaber":
        from .sources.scoresaber import BASE_URL, ScoreSaberSource

        return ScoreSaberSource(HttpClient(BASE_URL, rate_per_second=rate))
    if name == "beatleader":
        from .sources.beatleader import BASE_URL, BeatLeaderSource

        # BeatLeader allows 50 requests per 10 s on score endpoints.
        return BeatLeaderSource(HttpClient(BASE_URL, rate_per_second=min(rate, 4.5)))
    raise SystemExit(f"unknown source {name!r}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ppanalyzer", description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    fetch = sub.add_parser("fetch", help="download ranked players and their ranked plays")
    fetch.add_argument("--source", choices=["scoresaber", "beatleader"], required=True)
    fetch.add_argument("--out", type=Path, required=True, help="raw snapshot directory")
    fetch.add_argument("--min-rank", type=int, default=1)
    fetch.add_argument("--max-rank", type=int, default=30000)
    fetch.add_argument("--scores", type=int, default=100,
                       help="ranked plays per player, best first (more = less survivorship bias)")
    fetch.add_argument("--rate", type=float, default=5.0, help="requests per second")
    fetch.add_argument("--workers", type=int, default=4)

    merge = sub.add_parser("merge", help="combine rank-range parts into one raw snapshot")
    merge.add_argument("--out", type=Path, required=True)
    merge.add_argument("parts", type=Path, nargs="+")

    enrich = sub.add_parser("enrich", help="add BeatSaver keys, song length, tags, NJS/NPS to a snapshot")
    enrich.add_argument("--raw", type=Path, required=True)

    build = sub.add_parser("build", help="aggregate a raw snapshot into site data")
    build.add_argument("--raw", type=Path, required=True)
    build.add_argument("--out", type=Path, required=True, help="e.g. web/public/data/scoresaber")
    build.add_argument("--bucket-size", type=int, default=100)
    build.add_argument("--shards", type=int, default=256)

    sample = sub.add_parser("sample", help="generate a synthetic raw snapshot")
    sample.add_argument("--out", type=Path, required=True)
    sample.add_argument("--players", type=int, default=3000)
    sample.add_argument("--maps", type=int, default=600)
    sample.add_argument("--scores", type=int, default=300)
    sample.add_argument("--seed", type=int, default=7)

    sources = sub.add_parser("sources", help="rewrite sources.json for a site data directory")
    sources.add_argument("--site", type=Path, required=True)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    if args.command == "fetch":
        fetch_snapshot(make_source(args.source, args.rate), args.out, args.max_rank, args.scores,
                       workers=args.workers, min_rank=args.min_rank)
    elif args.command == "merge":
        meta = merge_snapshots(args.parts, args.out)
        logging.info("merged %d parts: %d players, %d maps", len(args.parts), meta["playerCount"],
                     meta["mapCount"])
    elif args.command == "enrich":
        enrich_snapshot(args.raw)
    elif args.command == "build":
        meta = build_site_data(args.raw, args.out, args.bucket_size, args.shards)
        logging.info("built %s: %d players, %d maps, %d buckets", args.out, meta["playerCount"],
                     meta["mapCount"], meta["bucketCount"])
    elif args.command == "sample":
        generate_sample(args.out, players=args.players, maps=args.maps, scores_per_player=args.scores,
                        seed=args.seed)
    elif args.command == "sources":
        write_sources_index(args.site)
    return 0


if __name__ == "__main__":
    sys.exit(main())
