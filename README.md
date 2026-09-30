# PP Analyzer

**https://brianhuang822.github.io/ppanalyzer/**

Find the ranked Beat Saber maps that players around your ScoreSaber or BeatLeader rank gain pp on,
ranked by how much they would raise *your* total, with one-click install, direct download and
playlist export.

## Using it

Type any of these into the search box:

| Input | Example | What you get |
| --- | --- | --- |
| Rank | `5234`, `#5,234` | Maps players ranked near #5,234 have in their top plays |
| Profile link | `https://scoresaber.com/u/7656…`, `https://beatleader.com/u/…` | Personal recommendations |
| Player ID | `76561198012345678` | Personal recommendations |
| Name | `Cerret` | Pick from matching players |

With a profile the app knows your plays. It hides maps you've played (toggle), predicts your pp on
the rest and sorts by **expected gain in total pp**. Without one you can sort by:

- **Most played at my rank**: the original 2021 ranking, with each appearance weighted `0.965^position` like pp.
- **Most rank-specific**: maps unusually common at your rank compared with every rank.
- **Highest avg pp**: the highest-scoring maps for players at your level.

Every map links to its **BeatSaver page** (click the title), plus:

- **Install**: `beatsaver://<key>` one-click install. It needs [ModAssistant](https://github.com/bsmg/ModAssistant) or
  [BSManager](https://github.com/Zagrios/bs-manager) with OneClick enabled for BeatSaver.
- **.zip**: direct download from BeatSaver's CDN.
- **Preview**: 3D preview in [ArcViewer](https://allpoland.github.io/ArcViewer/).
- **Scores**: the map's leaderboard.

**Download playlist (.bplist)** saves the current list for PlaylistManager / BSManager. Drop it in
`Beat Saber/Playlists`. Every setting is kept in the URL, so you can share a result.

## How the recommendations work

1. **Collect** (weekly GitHub Action). The job pulls the ranked players (ranks 1–30,000 by default) and their top
   100 ranked plays from the [ScoreSaber v2 API](https://scoresaber.com/api/v2) and the
   [BeatLeader API](https://api.beatleader.com). Maps missing a BeatSaver key are resolved through the
   [BeatSaver API](https://api.beatsaver.com).
2. **Aggregate**. Players are grouped into buckets of 100 by their *actual* rank. For each map, each bucket
   stores:
   - how many players have it in their top plays
   - the decay-weighted count
   - the sum of pp
   - the sum of accuracy
3. **Your peers**. The app loads the buckets covering `rank ± range`, or only the players ranked above you
   ("players just above me").
4. **Your predicted pp on a map** uses a bilinear model in the spirit of
   [BiRating (Casanova, 2025)](https://arxiv.org/abs/2502.19742), where `pp(player, map) ≈ skill(player) × value(map)`:
   - `value(map)` is the peers' mean pp on it.
   - `skill` is the median of `your pp / peers' mean pp` over the maps you share with them (at least 3 maps,
     clamped to 0.6–1.4).
5. **Expected gain**. Both leaderboards compute total pp as `Σ pp_i × 0.965^i` over your plays, best first. The
   decay is measured from the API's per-score `weight` field each run. The gain from a map is
   `total(your plays with this play inserted or improved) − total(your plays now)`. This is why a 300pp play
   can be worth less than 300pp to your total.

Caveats, stated plainly:

- **Correlation, not causation.** A map in your peers' top plays is one they score well on. It may not suit you.
- **Selection bias.** Peers' averages come only from plays good enough to be in their top 100, so they run high.
  Scaling by `skill` corrects some of this, not all.
- **Stale data.** Recommendations are only as fresh as the last refresh (weekly). Live lookups (below) keep
  *your* plays current.

## Live lookups vs. the snapshot

The app first asks the leaderboard API for your plays directly from the browser. That only works if the API sends
CORS headers. BeatLeader only allows its own sites, and ScoreSaber's v2 policy is undocumented. When the browser
can't reach the API, the app falls back to your plays as of the last snapshot. That works for any player inside
the snapshot's rank range, and the player card shows `live` or `snapshot`.

For live lookups for everyone, deploy [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js), a read-only,
allowlisted Cloudflare Worker (the free tier is enough). Then build with
`VITE_SCORESABER_API=https://<worker>/scoresaber` and `VITE_BEATLEADER_API=https://<worker>/beatleader`.

## Data for your own analysis

The **Refresh data** workflow publishes these assets on the rolling
[`data-latest` release](https://github.com/brianhuang822/ppanalyzer/releases/tag/data-latest):

- `raw-<source>.tar.gz`, containing:
  - `players.jsonl`: one player per line, `{id, name, country, rank, pp, scores: [[leaderboardId, pp, accuracy], …]}`
  - `leaderboards.jsonl`: one map per line (hash, BeatSaver key, song, mapper, difficulty, stars, cover)
  - `meta.json`
- `site-data-<source>.tar.gz`: the aggregated files the website serves.

The original February 2021 scrape is in [`data/legacy/scoresaber-2021-02-top8.json.gz`](data/legacy). It covers
32,393 players with their first 8 top plays, converted losslessly from the old pickles; pickle files can run
arbitrary code when loaded, JSON can't.

## Development

Requirements: Python ≥ 3.11 and Node ≥ 22.12.

```bash
# Pipeline
pip install -e "pipeline[dev]"
pytest pipeline && ruff check pipeline

# Synthetic data so the app runs offline (shows a "sample data" banner)
python -m ppanalyzer sample --out raw/sample
python -m ppanalyzer build --raw raw/sample --out web/public/data/sample

# Real data (needs network access to the APIs; about 2 h for 30k players at 5 req/s)
python -m ppanalyzer fetch --source scoresaber --out raw/scoresaber --max-rank 30000 --scores 100
python -m ppanalyzer build --raw raw/scoresaber --out web/public/data/scoresaber
# (re-running fetch resumes where it stopped)

# Web app
cd web
npm ci
npm run dev        # http://localhost:5173/ppanalyzer/
npm test && npm run lint && npm run typecheck
npm run build
```

Layout:

```
pipeline/   Python package: API clients (ScoreSaber v2, BeatLeader, BeatSaver), fetch, aggregate, sample data
web/        Vite + React + TypeScript app (static; reads web/public/data)
proxy/      Optional CORS proxy for live lookups
data/legacy Original 2021 dataset
.github/    CI, weekly data refresh, Pages deploy
```

## Deployment (one-time setup)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** The old site was served from `docs/`,
   which no longer exists.
2. **Actions → Refresh data → Run workflow.** It fetches both leaderboards in parallel (about 2 hours),
   publishes the `data-latest` release and deploys. After that it runs every Monday at 06:17 UTC.
3. Pushes to `main` that touch `web/` or `pipeline/` redeploy with the latest published data. Until the first
   refresh finishes, the site deploys with synthetic sample data and a banner saying so.

## What changed from the 2021 version

| 2021 | Now |
| --- | --- |
| HTML scraping of the pre-2021 ScoreSaber site (broken since its rewrite) | Official ScoreSaber v2 + BeatLeader APIs, with rate limiting, retries and resume |
| 8 plays per player | 100 ranked plays per player, with pp, accuracy, stars, BeatSaver key |
| Rank buckets built from list position (drifted after 4 missing files); rank 100 showed ranks 101–200 | Buckets keyed on each player's real rank |
| Popularity only; didn't know your plays | Personal expected-pp-gain ranking, played-map filter, lift, star filter |
| Song names only; link to the now-defunct beatsaver.io | BeatSaver page, one-click install, .zip, preview, leaderboard, .bplist export |
| One-off scrape (Feb 2021) | Weekly refresh via GitHub Actions |
| Create React App (deprecated), hand-built `docs/` committed to git | Vite, tests, lint, CI, Actions-deployed Pages |

## License

MIT. Not affiliated with ScoreSaber, BeatLeader or BeatSaver.
