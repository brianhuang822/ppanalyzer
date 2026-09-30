import pytest

from ppanalyzer.models import normalize_accuracy, normalize_difficulty, normalize_key, normalize_mode


@pytest.mark.parametrize("value, expected", [(0.9512, 0.9512), (95.12, 0.9512), ("97", 0.97), (None, 0.0),
                                             (101.0, 1.0)])
def test_normalize_accuracy(value, expected):
    assert normalize_accuracy(value) == pytest.approx(expected)


def test_normalize_accuracy_fallback():
    assert normalize_accuracy(0, fallback=0.93) == pytest.approx(0.93)


@pytest.mark.parametrize("value, expected", [(9, "ExpertPlus"), (7, "Expert"), (1, "Easy"),
                                             ("_ExpertPlus_SoloStandard", "ExpertPlus"),
                                             ("_Hard_SoloOneSaber", "Hard"), ("Expert+", "ExpertPlus"),
                                             ("expert", "Expert")])
def test_normalize_difficulty(value, expected):
    assert normalize_difficulty(value) == expected


@pytest.mark.parametrize("value, expected", [("SoloStandard", "Standard"), ("SoloOneSaber", "OneSaber"),
                                             ("Standard", "Standard"), (None, "Standard")])
def test_normalize_mode(value, expected):
    assert normalize_mode(value) == expected


@pytest.mark.parametrize("value, expected", [("2A1B", "2a1b"), ("1e3f5", "1e3f5"), ("abcx", None), ("", None),
                                             (None, None)])
def test_normalize_key(value, expected):
    assert normalize_key(value) == expected
