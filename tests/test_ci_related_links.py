"""CI-0177-05: a song's details can ask for only the word links that touch it."""

from __future__ import annotations

from types import SimpleNamespace

from test_api_contracts import (  # noqa: F401 - pytest fixtures shared with the contract tests
    _somewhere_for_files,
    client,
    conn,
    settings,
)


def _link(phrase: str, a: int, b: int) -> SimpleNamespace:
    line = SimpleNamespace(text=f"a line with {phrase}")
    return SimpleNamespace(
        phrase=phrase, kind="phrase", song_a=a, song_b=b, line_a=line, line_b=line
    )


def _fake_links(monkeypatch, found):
    import selecta.planner.prepare as prepare
    import selecta.planner.wordreel as wordreel

    library = {song_id: object() for song_id in range(1, 8)}
    monkeypatch.setattr(prepare, "best_links", lambda _links, _songs: (found, library, None))
    monkeypatch.setattr(wordreel, "modes_for", lambda _a, _b, _space: ("word_blend",))
    monkeypatch.setattr(
        prepare,
        "link_state",
        lambda _link, _moves, _status: ("word_blend", {"status": "none", "key": "k"}),
    )


def test_song_filter_keeps_only_links_that_touch_that_song(client, monkeypatch):  # noqa: F811
    _fake_links(monkeypatch, [_link("blue moon", 1, 2), _link("night", 3, 4), _link("home", 5, 1)])
    shown = client.get("/api/links", params={"song": 1}).json()["links"]
    assert [(row["a"], row["b"], row["phrase"]) for row in shown] == [
        (1, 2, "blue moon"),
        (5, 1, "home"),
    ]
    every = client.get("/api/links").json()["links"]
    assert len(every) == 3


def test_a_song_with_no_links_gets_an_empty_list_not_someone_elses(client, monkeypatch):  # noqa: F811
    _fake_links(monkeypatch, [_link("night", 3, 4)])
    assert client.get("/api/links", params={"song": 6}).json()["links"] == []
