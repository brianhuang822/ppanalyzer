"""The "overweighted map" model.

A map is *overweighted at a rank* when players around that rank score better on it than the
star rating says they should, so it pays more pp per unit of skill than a typical map.

Measured in accuracy, because pp is a deterministic, steep function of accuracy:

  acc(player, map) ~ A(stars) + offset(player) + overweight(map)

A(stars)          typical accuracy at that star rating for players in this rank band
offset(player)    how much better/worse this player is than their band (median residual)
overweight(map)   how much better than expected *everyone* does on this map (shrunk mean)

offset and overweight are fitted by alternating medians/means, the same iterative idea as
BiRating (Casanova 2025, arXiv:2502.19742). Accuracy turns into pp through a curve fitted
from the data itself (pp / stars vs. accuracy) and a per-map scale, so a change to the pp
formula on either leaderboard is picked up automatically.
"""

from __future__ import annotations

import bisect
import statistics
from collections import defaultdict
from collections.abc import Iterable, Sequence

PP_PER_STAR = 42.114296
# ScoreSaber's published curve (accuracy -> multiplier), used when there is too little data
# to fit one and to extend a fitted curve beyond the accuracies seen.
DEFAULT_CURVE = [
    (0.0, 0.0), (0.6, 0.18223233667439062), (0.65, 0.5866010012767576), (0.7, 0.6125565959114954),
    (0.75, 0.6451808210101443), (0.8, 0.6872268862950283), (0.825, 0.7150465663454271),
    (0.85, 0.7462290664143185), (0.875, 0.7816934560296046), (0.9, 0.825756123560842),
    (0.91, 0.8488375988124467), (0.92, 0.8728710341448851), (0.93, 0.9039994071865736),
    (0.94, 0.9417362980580238), (0.95, 1.0), (0.955, 1.0388633331418984), (0.96, 1.0871883573850478),
    (0.965, 1.1552120359501035), (0.97, 1.2485807759957321), (0.9725, 1.3090333065057616),
    (0.975, 1.3807102743105126), (0.9775, 1.4664726399289512), (0.98, 1.5702410055532239),
    (0.9825, 1.697536248647543), (0.985, 1.8563887693647105), (0.9875, 2.058947159052738),
    (0.99, 2.324506282149922), (0.99125, 2.4902905794106913), (0.9925, 2.685667856592722),
    (0.99375, 2.9190155639254955), (0.995, 3.2022017597337955), (0.99625, 3.5526145337555373),
    (0.9975, 3.996793606763322), (0.99825, 4.325027383589547), (0.999, 4.715470646416203),
    (0.9995, 5.019543595874787), (1.0, 5.367394282890631),
]

CURVE_BIN = 0.0025
CURVE_MIN_ACC = 0.6
STAR_BIN = 0.5


def default_pp_curve() -> list[list[float]]:
    """pp per star as a function of accuracy (ScoreSaber's formula)."""
    return [[acc, PP_PER_STAR * factor] for acc, factor in DEFAULT_CURVE]


def interpolate(table: Sequence[Sequence[float]], x: float) -> float:
    """Piecewise-linear lookup in a table of [x, y] sorted by x; clamps outside the range."""
    if not table:
        return 0.0
    xs = [row[0] for row in table]
    if x <= xs[0]:
        return float(table[0][1])
    if x >= xs[-1]:
        return float(table[-1][1])
    i = bisect.bisect_right(xs, x)
    (x0, y0), (x1, y1) = table[i - 1][:2], table[i][:2]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def fit_pp_curve(samples: Iterable[tuple[float, float]], min_per_bin: int = 20,
                 min_bins: int = 8) -> tuple[list[list[float]], bool]:
    """Fit pp-per-star vs. accuracy from (accuracy, pp / stars) samples.

    Medians per 0.25% accuracy bin, forced non-decreasing, and joined to the default curve's
    shape outside the observed range. Returns ``(curve, fitted)``; ``fitted`` is False when
    there was too little data and the default curve is returned instead.
    """
    bins: dict[int, list[float]] = defaultdict(list)
    last_bin = int((1 - CURVE_MIN_ACC) / CURVE_BIN) - 1
    for acc, value in samples:
        if acc >= CURVE_MIN_ACC and value > 0:
            bins[min(int((acc - CURVE_MIN_ACC) / CURVE_BIN), last_bin)].append(value)
    points = []
    for b in sorted(bins):
        if len(bins[b]) >= min_per_bin:
            points.append([round(CURVE_MIN_ACC + (b + 0.5) * CURVE_BIN, 5), statistics.median(bins[b])])
    if len(points) < min_bins:
        return default_pp_curve(), False
    for i in range(1, len(points)):
        points[i][1] = max(points[i][1], points[i - 1][1])

    default = default_pp_curve()
    low_acc, low_val = points[0]
    high_acc, high_val = points[-1]
    low_scale = low_val / max(interpolate(default, low_acc), 1e-9)
    high_scale = high_val / max(interpolate(default, high_acc), 1e-9)
    below = [[a, v * low_scale] for a, v in default if a < low_acc]
    above = [[a, v * high_scale] for a, v in default if a > high_acc]
    return below + points + above, True


def map_pp_scale(observations: Iterable[tuple[float, float]],
                 curve: Sequence[Sequence[float]]) -> float | None:
    """How much pp this map pays relative to the curve: median of pp / curve(accuracy).

    On ScoreSaber this equals the star rating; on BeatLeader it also absorbs the map's mix of
    pass / accuracy / tech rating.
    """
    ratios = [pp / base for acc, pp in observations if (base := interpolate(curve, acc)) > 0 and pp > 0]
    return statistics.median(ratios) if ratios else None


def _pav_decreasing(values: list[float], weights: list[float]) -> list[float]:
    """Weighted isotonic regression forcing a non-increasing sequence (pool adjacent violators)."""
    blocks: list[list[float]] = []  # [mean, weight, count]
    for value, weight in zip(values, weights, strict=True):
        blocks.append([value, weight, 1])
        while len(blocks) > 1 and blocks[-2][0] < blocks[-1][0]:
            v2, w2, c2 = blocks.pop()
            v1, w1, c1 = blocks.pop()
            blocks.append([(v1 * w1 + v2 * w2) / (w1 + w2), w1 + w2, c1 + c2])
    out: list[float] = []
    for value, _weight, count in blocks:
        out.extend([value] * int(count))
    return out


def accuracy_curve(plays: Iterable[tuple[float, float]], min_per_bin: int = 5) -> list[list[float]]:
    """Typical accuracy by star rating: [[star_center, median_acc, plays], ...].

    Harder maps never get easier to score on, so the curve is forced non-increasing.
    """
    bins: dict[int, list[float]] = defaultdict(list)
    for stars, acc in plays:
        if stars > 0 and acc > 0:
            bins[int(stars / STAR_BIN)].append(acc)
    rows = [[(b + 0.5) * STAR_BIN, statistics.median(v), len(v)] for b, v in sorted(bins.items())
            if len(v) >= min_per_bin]
    if not rows:
        return []
    smoothed = _pav_decreasing([r[1] for r in rows], [float(r[2]) for r in rows])
    return [[r[0], round(s, 5), r[2]] for r, s in zip(rows, smoothed, strict=True)]


def expected_accuracy(curve: Sequence[Sequence[float]], stars: float) -> float:
    return interpolate([[row[0], row[1]] for row in curve], stars)


def fit_band(plays: Sequence[tuple[int, str, float, float]], shrink: float = 10.0, iterations: int = 4,
             min_per_bin: int = 5) -> tuple[list[list[float]], dict[int, float], dict[str, list[float]]]:
    """Fit one rank band: accuracy-by-stars curve, player offsets and map overweights, alternating.

    ``plays`` rows are ``(player, map_id, stars, acc)``. Returns ``(curve, offsets, sums)`` where
    ``sums[map_id] = [n, sum_of_residuals]`` and residual = acc - A(stars) - offset(player). Raw
    sums are returned (not means) so the app can pool neighbouring bands before shrinking.

    The curve is fitted on accuracy *net of* each player's offset: hard maps are mostly played by
    the band's strongest players, and a curve of their raw accuracy would promise a typical player
    far too much on maps above their level. Offsets are centred on the band's median player, so
    the curve describes that typical player. Map overweights are deliberately *not* subtracted
    when fitting the curve (they would absorb the curve's own error at sparse star levels); the
    per-bin median keeps the curve robust to the minority of overweighted maps instead.
    """
    offsets: dict[int, float] = defaultdict(float)
    overweight: dict[str, float] = defaultdict(float)
    curve: list[list[float]] = []
    sums: dict[str, list[float]] = {}
    for _ in range(max(1, iterations)):
        net = ((stars, acc - offsets[p]) for p, _, stars, acc in plays)
        curve = accuracy_curve(net, min_per_bin=min_per_bin)
        if not curve:
            return [], {}, {}
        base = [acc - expected_accuracy(curve, stars) for _, _, stars, acc in plays]
        per_player: dict[int, list[float]] = defaultdict(list)
        for (player, map_id, _, _), b in zip(plays, base, strict=True):
            per_player[player].append(b - overweight[map_id])
        raw = {p: statistics.median(v) for p, v in per_player.items()}
        centre = statistics.median(raw.values())
        offsets = defaultdict(float, {p: v - centre for p, v in raw.items()})
        sums = {}
        for (player, map_id, _, _), b in zip(plays, base, strict=True):
            entry = sums.setdefault(map_id, [0, 0.0])
            entry[0] += 1
            entry[1] += b - offsets[player]
        overweight = defaultdict(float, {m: s / (n + shrink) for m, (n, s) in sums.items()})
    return curve, dict(offsets), sums


def typical_profile(pp_lists: Sequence[Sequence[float]], length: int = 100) -> list[float]:
    """Median pp at each position of a band's play lists: the "typical player" at this rank."""
    if not pp_lists:
        return []
    profile = []
    for i in range(length):
        values = [pps[i] if i < len(pps) else 0.0 for pps in pp_lists]
        value = statistics.median(values)
        if value <= 0:
            break
        profile.append(round(value, 2))
    return profile
