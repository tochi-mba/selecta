"""EX-0133-03: the scale profile reaches every song, opens the whole mix, times each call and names
the hardware. Run small here; the 20k/100-song run on recorded hardware is
`python tests/ex_0133_scale_profile.py 20000 100 profile.json`."""

import ex_0133_scale_profile as scale


def test_a_small_profile_reaches_every_song_and_records_the_machine():
    report = scale.profile(300, 20)
    assert report["songs_paged"] == report["library_total"] >= 300  # every song, once
    assert report["mix_reported"] == 20
    for name in ("library_pages", "library_search", "open_mix", "mix_options"):
        numbers = report[name]
        assert numbers["calls"] > 0
        assert 0 <= numbers["p50_ms"] <= numbers["p95_ms"] <= numbers["worst_ms"]
    assert report["rss_mb"] > 0
    machine = report["hardware"]
    assert machine["cores_logical"] >= 1 and machine["ram_gb"] > 0 and machine["os"]
    assert machine["named_by_person"] is None  # the profile never names the machine itself
    assert "person listens" in report["audio_continuity"]


def test_percentiles_come_from_the_samples():
    numbers = scale.timings([0.010, 0.020, 0.030, 0.040, 0.100])
    assert numbers == {"calls": 5, "p50_ms": 30.0, "p95_ms": 100.0, "worst_ms": 100.0}
