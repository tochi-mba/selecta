import numpy as np

from selecta.discovery.sequence import harmonic_sequence


def test_sequence_finds_offset_and_fixed_transposition():
    progression = np.eye(12)[[0, 4, 7, 2, 5, 9, 1, 6]]
    other = np.vstack([np.zeros((3, 12)), np.roll(progression, 2, axis=1)])
    match = harmonic_sequence(progression, other)
    assert match is not None
    assert (match["a_bar"], match["b_bar"], match["transpose"]) == (0, 3, 10)
    assert match["similarity"] == 1


def test_sequence_rejects_same_average_with_changed_order_and_stationary_audio():
    progression = np.eye(12)[[0, 4, 7, 2, 5, 9, 1, 6]]
    assert harmonic_sequence(progression, progression[::-1]) is None
    held = np.tile(np.eye(12)[0], (12, 1))
    assert harmonic_sequence(held, held) is None
    assert harmonic_sequence(np.zeros((12, 12)), progression) is None
    assert harmonic_sequence(progression[:3], progression) is None
    assert harmonic_sequence(progression * np.nan, progression) is None
