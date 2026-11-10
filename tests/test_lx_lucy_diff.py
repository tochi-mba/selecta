"""LX-0361-03: comparing two revisions says what happened to verified transitions, by directed
occurrence pair, and not only how many songs changed."""

from __future__ import annotations

from selecta.lucy import proposals


def snap(order: list[str], ready: set[tuple[str, str]]) -> dict:
    songs = [{"occurrence": occ, "song_id": index + 1, "title": occ} for index, occ in enumerate(order)]
    seams = [
        {"a_occ": a, "b_occ": b, "key": f"{a}>{b}",
         "ready": {"status": "already_rendered" if (a, b) in ready else "none",
                   "verified": (a, b) in ready}}
        for a, b in zip(order, order[1:])
    ]
    return {"songs": songs, "seams": seams, "constraints": []}


def test_readiness_change_counts_only_verified_directed_pairs():
    before = snap(["a", "b", "c", "d"], {("a", "b"), ("b", "c"), ("c", "d")})
    # c and d swap: a>b stays ready, b>d and d>c are new pairs nobody has rendered
    after = snap(["a", "b", "d", "c"], {("a", "b")})
    change = proposals.diff(before, after)
    assert change["readiness"] == {
        "before": {"ready": 3, "needed": 3},
        "after": {"ready": 1, "needed": 3},
        "kept": 1, "lost": 2, "gained": 0,
    }
    # the song counts alone would hide this: nothing was added or removed
    assert change["counts"]["added"] == 0 and change["counts"]["removed"] == 0


def test_a_rendered_but_unverified_clip_is_never_counted_ready():
    before = snap(["a", "b"], set())
    after = snap(["a", "b"], set())
    after["seams"][0]["ready"] = {"status": "already_rendered", "verified": False}
    assert proposals.diff(before, after)["readiness"]["after"]["ready"] == 0


def test_reversed_pairs_are_different_transitions():
    before = snap(["a", "b"], {("a", "b")})
    after = snap(["b", "a"], {("b", "a")})
    readiness = proposals.diff(before, after)["readiness"]
    assert (readiness["kept"], readiness["lost"], readiness["gained"]) == (0, 1, 1)


def test_a_first_revision_has_nothing_before_it():
    readiness = proposals.diff(None, snap(["a"], set()))["readiness"]
    assert readiness["before"] == {"ready": 0, "needed": 0}
    assert readiness["after"] == {"ready": 0, "needed": 0}
