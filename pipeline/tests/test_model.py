import json
import random

import pytest

from ppanalyzer.build import build_site_data
from ppanalyzer.model import (
    DEFAULT_CURVE,
    PP_PER_STAR,
    accuracy_curve,
    default_pp_curve,
    expected_accuracy,
    fit_band,
    fit_pp_curve,
    interpolate,
    map_pp_scale,
    typical_profile,
)
from ppanalyzer.sample import generate_sample


def test_interpolate_clamps_and_interpolates():
    table = [[0.9, 1.0], [0.95, 2.0], [1.0, 4.0]]
    assert interpolate(table, 0.5) == 1.0
    assert interpolate(table, 0.925) == pytest.approx(1.5)
    assert interpolate(table, 0.99) == pytest.approx(3.6)
    assert interpolate(table, 2) == 4.0
    assert interpolate([], 1) == 0.0


def test_fit_pp_curve_recovers_scoresaber_curve():
    rng = random.Random(1)
    samples = []
    for _ in range(40000):
        acc = rng.uniform(0.8, 0.99)
        samples.append((acc, PP_PER_STAR * interpolate(DEFAULT_CURVE, acc) * rng.uniform(0.99, 1.01)))
    curve, fitted = fit_pp_curve(samples)
    assert fitted
    for acc in [0.85, 0.93, 0.96, 0.98, 0.985]:
        expected = PP_PER_STAR * interpolate(DEFAULT_CURVE, acc)
        assert interpolate(curve, acc) == pytest.approx(expected, rel=0.02)
    # Beyond the observed range it follows the default curve's shape instead of going flat.
    assert interpolate(curve, 0.999) > interpolate(curve, 0.99) * 1.5
    values = [v for _, v in curve]
    assert values == sorted(values)


def test_fit_pp_curve_falls_back_without_data():
    curve, fitted = fit_pp_curve([(0.95, 40.0)] * 10)
    assert not fitted and curve == default_pp_curve()


def test_map_pp_scale_is_star_rating_on_scoresaber():
    curve = default_pp_curve()
    obs = [(acc, 7.5 * interpolate(curve, acc)) for acc in (0.9, 0.95, 0.97)]
    assert map_pp_scale(obs, curve) == pytest.approx(7.5)
    assert map_pp_scale([], curve) is None


def test_accuracy_curve_is_non_increasing_with_stars():
    points = [(4.1, 0.97), (4.2, 0.96), (6.1, 0.955), (6.2, 0.962), (8.0, 0.94), (8.2, 0.93)]
    plays = [point for point in points for _ in range(5)]
    plays += [(10.1, 0.95)] * 5  # noisy bin that would break monotonicity
    curve = accuracy_curve(plays)
    accs = [row[1] for row in curve]
    assert accs == sorted(accs, reverse=True)
    assert [row[0] for row in curve] == [4.25, 6.25, 8.25, 10.25]
    assert expected_accuracy(curve, 5.25) == pytest.approx((accs[0] + accs[1]) / 2)


def test_fit_overweight_finds_the_easy_map_and_player_skill():
    rng = random.Random(3)
    truth_offset = {p: rng.uniform(-0.01, 0.01) for p in range(60)}
    truth_ow = {f"m{i}": (0.012 if i in (3, 7) else 0.0) for i in range(20)}
    stars = {f"m{i}": 4 + i * 0.4 for i in range(20)}
    plays = []
    for p, offset in truth_offset.items():
        for m in rng.sample(sorted(stars), 12):
            acc = 0.99 - 0.005 * stars[m] + offset + truth_ow[m] + rng.gauss(0, 0.002)
            plays.append((p, m, stars[m], acc))
    _, offsets, sums = fit_band(plays, min_per_bin=3)
    ranked = sorted(sums, key=lambda m: -sums[m][1] / (sums[m][0] + 10))
    assert set(ranked[:2]) == {"m3", "m7"}
    # Offsets track true skill differences.
    best, worst = max(truth_offset, key=truth_offset.get), min(truth_offset, key=truth_offset.get)
    assert offsets[best] - offsets[worst] > 0.012


def test_fit_band_does_not_let_strong_players_inflate_hard_maps():
    """Only the strongest players reach 10* maps. A curve of raw accuracy would promise the typical
    player their 97%; net of their offsets it should sit near the typical player's true ~92%."""
    rng = random.Random(5)
    plays = []
    for p in range(200):
        strong = p < 20
        offset = 0.02 if strong else rng.uniform(-0.004, 0.004)
        for stars in ([4, 5, 6, 7, 10, 10.2] if strong else [4, 5, 6, 7]):
            for k in range(3):
                true_typical = 0.99 - 0.007 * stars
                plays.append((p, f"m{stars}-{k}", stars, true_typical + offset + rng.gauss(0, 0.001)))
    curve, offsets, _ = fit_band(plays, min_per_bin=3)
    assert expected_accuracy(curve, 10.25) == pytest.approx(0.99 - 0.007 * 10.1, abs=0.004)
    assert expected_accuracy(curve, 4.25) == pytest.approx(0.99 - 0.007 * 4, abs=0.003)
    assert offsets[0] == pytest.approx(0.02, abs=0.004) and abs(offsets[100]) < 0.006


def test_typical_profile_is_positionwise_median():
    assert typical_profile([[400, 300, 200], [380], [250, 200]]) == [380.0, 200.0]
    assert typical_profile([]) == []


def test_build_finds_planted_overweight_maps(tmp_path):
    """End to end on synthetic data with known answers: the most overweighted maps the site
    data implies should be the ones the generator made easy."""
    raw = tmp_path / "raw"
    generate_sample(raw, players=600, maps=200, scores_per_player=200, fetched_at="2026-01-01T00:00:00Z")
    planted = set(json.loads((raw / "meta.json").read_text())["plantedOverweight"])
    site = tmp_path / "site" / "sample"
    build_site_data(raw, site, shard_count=4)
    ids = [row[0] for row in json.loads((site / "maps.json").read_text())["rows"]]
    pooled: dict[str, list[float]] = {}
    for b in range(0, 3):
        bucket = json.loads((site / "buckets" / f"{b}.json").read_text())
        for idx, count, _w, _pp, _acc, resid, _recent in bucket["rows"]:
            entry = pooled.setdefault(ids[idx], [0, 0.0])
            entry[0] += count
            entry[1] += resid
    candidates = [m for m, (n, _) in pooled.items() if n >= 3]
    ranked = sorted(candidates, key=lambda m: -pooled[m][1] / (pooled[m][0] + 10))
    top = ranked[:10]
    assert sum(m in planted for m in top) >= 9
