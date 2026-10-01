# PP Analyzer

**https://brianhuang822.github.io/ppanalyzer/**

Find the ranked Beat Saber maps that give players at your ScoreSaber or BeatLeader rank **more pp than their
star rating suggests** ("overweighted" maps), ranked by how much they would raise *your* total, with one-click
install, direct download, and auto-updating in-game playlists.

## Using it

Type any of these into the search box:

| Input | Example | What you get |
| --- | --- | --- |
| Rank | `5234`, `#5,234` | Maps ranked for a typical player at #5,234 |
| Profile link | `https://scoresaber.com/u/7656…`, `https://beatleader.com/u/…` | Predictions calibrated to you |
| Player ID | `76561198012345678` | Predictions calibrated to you |
| Name | `Cerret` | Pick from matching players |

Sort orders:

- **Fastest climb (default)**: the increase in your *total* pp from the play you're predicted to set. Without a
  profile it uses a typical player at that rank.
- **Fastest climb per minute**: the same divided by song length, since short maps allow more attempts.
- **Most overweighted**: how much more pp players at your rank get on the map than on a typical map of its star
  rating, e.g. "Overweighted +18% pp".
- **Being farmed now**: maps players in your range set scores on in the last 30 days.
- **Most played at my rank**: the original 2021 ranking.

Filters:

- **Maps**: *new to me*, *ones I can improve* (your existing scores below what you're predicted to get), or both.
- **Stars**, **style** (BeatSaver tags such as tech, speed or accuracy), and the comparison range ("players
  around me" or "players just above me").

Every map links to its **BeatSaver page** (click the title), plus:

- **Install**: `beatsaver://<key>` one-click install. It needs [ModAssistant](https://github.com/bsmg/ModAssistant) or
  [BSManager](https://github.com/Zagrios/bs-manager) with OneClick enabled for BeatSaver.
- **.zip**: direct download from BeatSaver's CDN.
- **Preview**: 3D preview in [ArcViewer](https://allpoland.github.io/ArcViewer/).
- **Scores**: the map's leaderboard.

Badges flag:

- overweighted maps
- maps "🔥" farmed recently by players near you
- newly ranked maps, which few players have farmed yet
- song length, NJS, style tags, and any required mods

Playlists come in two kinds:

- **Install playlist** adds the auto-updating playlist for your rank band (40 maps, rebuilt weekly). It carries a
  [`syncURL`](https://github-wiki-see.page/m/rithik-b/PlaylistManager/wiki/SyncURL), so PlaylistManager's Sync
  button pulls next week's list in-game.
- **Download playlist (.bplist)** saves exactly the list you're looking at.

Every setting is kept in the URL, so you can share a result.

## How "overweighted" is measured

pp is a steep function of accuracy. On ScoreSaber, pp = 42.11 × stars × multiplier(accuracy), where +1% accuracy
is worth about +9% pp at 95% and about +26% at 97%. So the model works in accuracy:

```
accuracy(player, map) ≈ A_rank(stars) + offset(player) + overweight_rank(map)
```

- **`A_rank(stars)`** is the typical accuracy players in that rank band get at each star rating. It is a median
  per 0.5★, forced non-increasing.
- **`offset(player)`** is how much better or worse the player is than their band.
- **`overweight_rank(map)`** is how much better than expected *everyone* in the band does on the map.

The offsets and overweights are fitted by alternating medians and means, the iterative idea behind
[BiRating (Casanova, 2025)](https://arxiv.org/abs/2502.19742). Each map's overweight is pulled toward 0 by 10
pseudo-plays, so a handful of lucky scores can't top the list.

Accuracy turns back into pp through:
- a pp-vs-accuracy curve **fitted from the snapshot itself**, so a formula change on either leaderboard is
  picked up automatically
- a per-map scale, which equals the star rating on ScoreSaber and absorbs the pass/acc/tech mix on BeatLeader.

Your prediction for a map is:

```
A(stars) + your offset + the map's overweight + your style affinity
```

Style affinity is how you do on maps with the same BeatSaver tags; it is shrunk and capped at ±1%. The gain is
`total(your plays with this one inserted or improved) − total(now)` under the `Σ pp_i × 0.965^i` weighting both
leaderboards use.

Data that makes this work:

- **Deep play lists** (up to 500 ranked plays per player by default), and players whose every play was fetched
  are flagged. With only top plays, a map 50 players tried and did badly on looks the same as one nobody tried
  (survivorship bias).
- **When each score was set**, which powers "being farmed now".
- **BeatSaver metadata**: song length, tags, NJS/NPS, required mods.

**Is it real? It's checked every week.** The refresh compares last week's predictions with the scores players
actually set since:
- Does adding overweight shrink the prediction error?
- Does it correlate with how much better than expected players did?
- When players played a map from each list, how much did it raise their total?

The results show under "How does this work?" on the site.

On synthetic data with planted overweighted maps:
- The model ranked the planted maps first (AUC ≈ 1.0).
- Adding overweight cut accuracy error by 16%.
- Maps from *Fastest climb* added about 2.5× more total pp per map played than *Most played* (122 vs 48). This
  is also why *Most overweighted* alone isn't the default: a heavily overweighted 4★ map still doesn't beat
  your current plays.

Caveats:

- The weekly check is observational: players never saw the lists.
- Rating teams reweight maps, so an edge can disappear.
- Recommendations are only as fresh as the last weekly refresh. Live lookups (below) keep *your* plays current.

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
  - `players.jsonl`: one player per line, `{id, name, country, rank, pp, complete, scores: [[leaderboardId, pp,
    accuracy, setAtUnixSeconds], …]}`
  - `leaderboards.jsonl`: one map per line (hash, BeatSaver key, song, mapper, difficulty, stars, cover, ranked
    date, length, tags, NJS, NPS, required mods)
  - `meta.json`
- `site-data-<source>.tar.gz`: the aggregated files the website serves, plus `backtest.json`, the weekly model
  check.

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

# Real data (needs network access to the APIs). Fetch in rank-range parts (in parallel on several
# machines if you like), merge, add BeatSaver metadata, build. Re-running fetch resumes where it stopped.
python -m ppanalyzer fetch --source scoresaber --out raw/ss-1 --min-rank 1 --max-rank 15000 --scores 500
python -m ppanalyzer fetch --source scoresaber --out raw/ss-2 --min-rank 15001 --max-rank 30000 --scores 500
python -m ppanalyzer merge --out raw/scoresaber raw/ss-1 raw/ss-2
python -m ppanalyzer enrich --raw raw/scoresaber
python -m ppanalyzer build --raw raw/scoresaber --out web/public/data/scoresaber

# Web app
cd web
npm ci
npm run dev        # http://localhost:5173/ppanalyzer/
npm test && npm run lint && npm run typecheck
npm run playlists -- --data public/data --site-url http://localhost:4173/ppanalyzer/   # rank-band playlists
npm run backtest -- --before-site <old site>/scoresaber --before-raw <old raw> --after-raw <new raw> --out x.json
npm run build
```

Layout:

```
pipeline/   Python package: API clients (ScoreSaber v2, BeatLeader, BeatSaver), fetch/merge/enrich,
            the overweight model (model.py), aggregation (build.py), synthetic data with known answers
web/        Vite + React + TypeScript app (static; reads web/public/data)
web/scripts Node scripts sharing the app's model: rank-band playlists, weekly backtest
proxy/      Optional CORS proxy for live lookups
data/legacy Original 2021 dataset
.github/    CI, weekly data refresh, Pages deploy
```

## Deployment (one-time setup)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** The old site was served from `docs/`,
   which no longer exists.
2. **Actions → Refresh data → Run workflow.** It fetches both leaderboards, each split into rank-range parts on
   parallel runners (default 2 parts × 15,000 players × up to 500 plays; roughly 2–4 hours per part at 5
   requests/s, inside the 5.5-hour job timeout; raise `parts` if one times out).
   It then merges, enriches, builds, runs the backtest, publishes the `data-latest` release and deploys. After that
   it runs every Monday at 06:17 UTC. Inputs let you change the rank range, play depth and number of parts.
3. Pushes to `main` that touch `web/` or `pipeline/` redeploy with the latest published data. Until the first
   refresh finishes, the site deploys with synthetic sample data and a banner saying so.

## What changed from the 2021 version

| 2021 | Now |
| --- | --- |
| HTML scraping of the pre-2021 ScoreSaber site (broken since its rewrite) | Official ScoreSaber v2 + BeatLeader APIs, with rate limiting, retries and resume |
| 8 plays per player | Up to 500 ranked plays per player, with pp, accuracy, stars, timestamps, BeatSaver metadata |
| Rank buckets built from list position (drifted after 4 missing files); rank 100 showed ranks 101–200 | Buckets keyed on each player's real rank |
| Popularity only; didn't know your plays | Overweight model (accuracy above what stars imply), personal climb ranking, improve view, style/star filters, weekly backtest |
| Song names only; link to the now-defunct beatsaver.io | BeatSaver page, one-click install, .zip, preview, leaderboard, .bplist export, auto-syncing rank-band playlists |
| One-off scrape (Feb 2021) | Weekly refresh via GitHub Actions |
| Create React App (deprecated), hand-built `docs/` committed to git | Vite, tests, lint, CI, Actions-deployed Pages |

## License

MIT. Not affiliated with ScoreSaber, BeatLeader or BeatSaver.
