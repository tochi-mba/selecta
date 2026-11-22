"""Word connections between catalogue songs in browser-first Cloud (`GET /api/local-media/links`,
`discover.word_links`, migration `bf0470lyrics01`): the route is dark while `lyrics.display` is
off, LRCLIB is asked once per song through the platform-wide rate bucket, the answers are cached
per song and per workspace, only metadata is sent, and the only move a link names is `word_cut`.

Migration up and down for `local_song_lyrics` is covered by `tests/test_cloud_migrations.py`.
"""

from __future__ import annotations

import httpx
import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import flags, modes
from selecta.identity.tokens import Claims
from selecta.local_media import links
from selecta.local_media.lyrics_schema import local_song_lyrics
from selecta.lyrics import lrclib
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)

LINKS = "/api/local-media/links"

# Song 1 ends a line on "midnight" and song 2 opens a line with it, so the matcher links 1 -> 2.
LYRICS = {
    "Leaving": (
        "[01:10.00] We keep on running till midnight\n"
        "[01:15.00] Nobody here can slow us down\n"
        "[01:20.00] Hold the door until the morning comes\n"
    ),
    "Arriving": (
        "[00:08.00] Midnight is calling out my name\n"
        "[00:13.00] Every window in the city glows\n"
        "[00:18.00] Carry me over the river tonight\n"
    ),
}


class FakeLrcLib:
    """Stands in for the `LrcLib` client `links.lrclib_lookup` builds: it answers from `LYRICS`
    by title and keeps every call, so a test can count what was asked and see what was sent."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str | None, float]] = []
        self.fail: set[str] = set()

    def __call__(self) -> FakeLrcLib:
        return self

    def lookup(self, artist: str, title: str, album: str | None, duration: float) -> dict | None:
        self.calls.append((artist, title, album, duration))
        if title in self.fail:
            raise httpx.ConnectError("LRCLIB is down")
        if title == "Instrumental":
            return {"instrumental": True}
        if title == "Plain":
            return {"plainLyrics": "words without times"}
        synced = LYRICS.get(title)
        return {"syncedLyrics": synced} if synced else None

    def titles(self) -> list[str]:
        return [title for _, title, _, _ in self.calls]


@pytest.fixture
def lyrics_on():
    """`lyrics.display` is off in Cloud by default and only the build can turn it on."""
    flags.use("+lyrics.display")
    yield
    flags.use(None)


@pytest.fixture
def lrc(monkeypatch):
    fake = FakeLrcLib()
    monkeypatch.setattr(lrclib, "LrcLib", fake)
    links._links_cache._entries.clear()
    return fake


def _register(party, token: str, songs: list[dict]) -> list[int]:
    answer = party.client.post(
        "/api/local-media/songs",
        headers=auth(token),
        json={
            "songs": [
                {"content_sha256": f"{index + 1:x}" * 64, "duration_s": 200.0, **song}
                for index, song in enumerate(songs)
            ]
        },
    )
    assert answer.status_code == 200, answer.text
    return [entry["song_id"] for entry in answer.json()["songs"]]


PAIR = [
    {"title": "Leaving", "artist": "Rex", "album": "First"},
    {"title": "Arriving", "artist": "Tochi"},
]


def _links(party, token: str = ALICE, **params) -> dict:
    answer = party.client.get(LINKS, headers=auth(token), params=params)
    assert answer.status_code == 200, answer.text
    return answer.json()


def _cached(party, token: str) -> list[dict]:
    workspace_id = party.workspaces[token]
    with transaction(party.engine, workspace_id) as conn:
        return [
            dict(row)
            for row in conn.execute(
                sa.select(local_song_lyrics)
                .where(local_song_lyrics.c.workspace_id == workspace_id)
                .order_by(local_song_lyrics.c.song_id)
            ).mappings()
        ]


def test_word_connections_ship_dark_in_the_cloud_build(lrc, party):
    answer = party.client.get(LINKS, headers=auth(ALICE))
    assert answer.status_code == 403
    refusal = answer.json().get("detail", answer.json())
    assert refusal["code"] == "flag_off", refusal
    assert refusal["flag"] == "discover.word_links"
    assert lrc.calls == [], "a dark route never asks LRCLIB anything"


def test_the_route_needs_a_signed_in_member(lrc, party, lyrics_on):
    assert party.client.get(LINKS).status_code == 401
    assert lrc.calls == []


def test_a_link_is_found_between_two_catalogue_songs_and_names_only_word_cut(
    lrc, party, lyrics_on
):
    first, second = _register(party, ALICE, PAIR)
    body = _links(party)
    assert body["found"] == 1
    [link] = body["links"]
    assert (link["a"], link["b"]) == (first, second)
    assert link["phrase"] == "midnight"
    assert (link["title_a"], link["artist_a"]) == ("Leaving", "Rex")
    assert (link["title_b"], link["artist_b"]) == ("Arriving", "Tochi")
    assert "midnight" in link["line_a"].lower() and "midnight" in link["line_b"].lower()
    assert link["moves"] == ["word_cut"] == links.WORD_MOVES
    assert body["lyrics"] == {
        "songs": 2,
        "checked": 2,
        "synced": 2,
        "waiting": 0,
        "looked_up": 2,
        "looking_up": True,
    }


def test_only_artist_title_album_and_duration_are_sent_to_lrclib(lrc, party, lyrics_on):
    _register(party, ALICE, PAIR)
    _links(party)
    assert lrc.calls == [("Rex", "Leaving", "First", 200.0), ("Tochi", "Arriving", None, 200.0)]


def test_each_song_is_asked_about_once_and_the_answer_is_kept(lrc, party, lyrics_on):
    _register(party, ALICE, PAIR)
    first = _links(party)
    again = _links(party)
    assert lrc.titles() == ["Leaving", "Arriving"], "the second call read the cache"
    assert again["links"] == first["links"]
    assert again["lyrics"]["looked_up"] == 0
    assert [row["status"] for row in _cached(party, ALICE)] == ["synced", "synced"]


def test_a_call_looks_up_a_few_songs_and_the_next_call_carries_on(lrc, party, lyrics_on):
    count = links.LOOKUPS_PER_CALL + 2
    _register(party, ALICE, [{"title": f"Unknown {n}", "artist": "Rex"} for n in range(count)])
    first = _links(party)["lyrics"]
    assert first["looked_up"] == links.LOOKUPS_PER_CALL == len(lrc.calls)
    assert (first["checked"], first["waiting"]) == (links.LOOKUPS_PER_CALL, 2)
    second = _links(party)["lyrics"]
    assert second["looked_up"] == 2 and second["waiting"] == 0
    assert len(set(lrc.titles())) == len(lrc.calls) == count
    assert {row["status"] for row in _cached(party, ALICE)} == {"missing"}


def test_only_synced_text_is_kept_and_every_kind_of_answer_is_remembered(lrc, party, lyrics_on):
    _register(
        party,
        ALICE,
        [
            {"title": "Leaving", "artist": "Rex"},
            {"title": "Instrumental", "artist": "Rex"},
            {"title": "Plain", "artist": "Rex"},
            {"title": "Nothing known", "artist": "Rex"},
        ],
    )
    _links(party)
    rows = _cached(party, ALICE)
    assert [row["status"] for row in rows] == ["synced", "instrumental", "plain", "missing"]
    assert [row["synced"] is not None for row in rows] == [True, False, False, False]
    # nothing about audio, paths or devices is stored beside the answer
    assert set(rows[0]) == {"workspace_id", "song_id", "status", "synced", "fetched_at"}


def test_a_failed_lookup_fails_that_song_only_and_is_asked_again_after_an_hour(
    lrc, party, lyrics_on, monkeypatch
):
    _register(party, ALICE, PAIR)
    lrc.fail.add("Leaving")
    body = _links(party)
    assert body["links"] == [] and body["lyrics"]["waiting"] == 1
    assert [row["status"] for row in _cached(party, ALICE)] == ["error", "synced"]

    lrc.fail.clear()
    assert _links(party)["lyrics"]["looked_up"] == 0, "not asked again straight away"
    monkeypatch.setattr(links, "RETRY_ERROR_AFTER_S", -1.0)
    healed = _links(party)
    assert healed["lyrics"]["looked_up"] == 1 and healed["found"] == 1
    assert lrc.titles() == ["Leaving", "Arriving", "Leaving"]
    assert [row["status"] for row in _cached(party, ALICE)] == ["synced", "synced"]


def test_links_can_be_narrowed_by_text_song_and_limit(lrc, party, lyrics_on):
    _first, second = _register(party, ALICE, PAIR)
    assert len(_links(party, q="MIDNIGHT")["links"]) == 1
    narrowed = _links(party, q="no such phrase")
    assert narrowed["links"] == [] and narrowed["found"] == 1
    assert len(_links(party, song=second)["links"]) == 1
    assert _links(party, song=second + 50)["links"] == []
    assert party.client.get(LINKS, headers=auth(ALICE), params={"limit": 0}).status_code == 422
    too_many = {"limit": links.MAX_LINKS + 1}
    assert party.client.get(LINKS, headers=auth(ALICE), params=too_many).status_code == 422


def test_another_workspace_sees_none_of_the_songs_lyrics_or_links(lrc, party, lyrics_on):
    _register(party, ALICE, PAIR)
    assert _links(party, ALICE)["found"] == 1
    asked = len(lrc.calls)

    theirs = _links(party, BOB)
    assert theirs["links"] == [] and theirs["found"] == 0
    assert theirs["lyrics"]["songs"] == 0
    assert len(lrc.calls) == asked, "Bob has no songs, so nothing was looked up for him"
    assert _cached(party, BOB) == []

    # Bob cannot read Alice's workspace by naming it either
    named = party.client.get(LINKS, headers=auth(BOB, party.workspaces[ALICE]))
    assert named.status_code in (403, 404), named.text
    assert len(lrc.calls) == asked

    # the same two songs in Bob's catalogue are looked up for Bob, into Bob's own rows
    _register(party, BOB, PAIR)
    assert _links(party, BOB)["found"] == 1
    assert len(lrc.calls) == asked + 2
    assert {row["workspace_id"] for row in _cached(party, BOB)} == {party.workspaces[BOB]}
    assert {row["workspace_id"] for row in _cached(party, ALICE)} == {party.workspaces[ALICE]}


# ---- the pieces, without the cloud app's flag gate


class _Principal:
    def __init__(self, workspace_id: str, allowed: bool = True) -> None:
        self.workspace = type("Workspace", (), {"id": workspace_id})()
        self.allowed = allowed

    def can(self, _action) -> bool:
        return self.allowed


def _bare_client(party, principal: _Principal, lookup, *, may_look_up: bool) -> TestClient:
    """The same handler on a bare app, with the lookup and the `lyrics.lookup` answer chosen."""
    app = FastAPI()
    links.install_routes(
        app,
        engine=party.engine,
        current_claims=lambda: Claims(subject="u", issued_at=0, expires_at=1),
        principal_for=lambda *_args: principal,
        lookup=lookup,
        may_look_up=lambda: may_look_up,
    )
    return TestClient(app)


def test_with_lookups_off_the_route_reads_the_cache_and_asks_nothing(lrc, party, lyrics_on):
    _register(party, ALICE, PAIR)
    assert _links(party)["found"] == 1
    _register(party, ALICE, [*PAIR, {"title": "Third", "artist": "Rex"}])

    def refuse(*_args):
        raise AssertionError("LRCLIB must not be asked while lookups are off")

    principal = _Principal(party.workspaces[ALICE])
    answer = _bare_client(party, principal, refuse, may_look_up=False).get(LINKS)
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["found"] == 1
    assert body["lyrics"]["looking_up"] is False
    assert (body["lyrics"]["waiting"], body["lyrics"]["looked_up"]) == (1, 0)


def test_a_member_who_cannot_read_the_library_is_refused_before_any_lookup(
    lrc, party, lyrics_on
):
    _register(party, ALICE, PAIR)
    principal = _Principal(party.workspaces[ALICE], allowed=False)
    answer = _bare_client(party, principal, lrc.lookup, may_look_up=True).get(LINKS)
    assert answer.status_code == 403
    assert answer.json()["detail"]["code"] == "not_allowed"
    assert lrc.calls == []


def test_a_song_without_a_length_is_never_sent_to_lrclib(lrc, party, lyrics_on):
    _register(party, ALICE, [{"title": "Leaving", "artist": "Rex", "duration_s": None}])
    assert _links(party)["lyrics"]["checked"] == 1
    assert lrc.calls == []
    assert [row["status"] for row in _cached(party, ALICE)] == ["missing"]


def test_no_new_lookup_starts_once_the_call_s_time_is_spent(lrc, party, lyrics_on):
    _register(party, ALICE, [{"title": f"Unknown {n}", "artist": "Rex"} for n in range(3)])
    ticks = iter([0.0, 1.0, 100.0, 200.0])
    done = links.look_up_some(
        party.engine, party.workspaces[ALICE], lrc.lookup, budget_s=6.0, clock=lambda: next(ticks)
    )
    assert done == 1 == len(lrc.calls)


def test_lrclib_s_answer_is_read_the_way_local_mode_reads_it():
    assert links.answer_of(None) == ("missing", None)
    assert links.answer_of({}) == ("missing", None)
    assert links.answer_of({"instrumental": True, "syncedLyrics": "x"}) == ("instrumental", None)
    assert links.answer_of({"syncedLyrics": "[00:01.00] hi", "plainLyrics": "hi"}) == (
        "synced",
        "[00:01.00] hi",
    )
    assert links.answer_of({"plainLyrics": "hi"}) == ("plain", None)


def test_the_real_lookup_takes_a_token_from_the_shared_lrclib_bucket(monkeypatch):
    """`lrclib_lookup` goes through `LrcLib`, which in cloud mode runs every request behind the
    process queue and its platform-wide bucket; and what goes over the wire is metadata only."""
    taken: list[str] = []
    requests: list[httpx.Request] = []

    class Bucket:
        def acquire(self) -> None:
            taken.append("lrclib")

    def answer(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"syncedLyrics": LYRICS["Leaving"]})

    real = lrclib.LrcLib
    client = httpx.Client(transport=httpx.MockTransport(answer))
    monkeypatch.setattr(lrclib, "LrcLib", lambda: real(client))
    monkeypatch.setattr(modes, "current_mode", lambda: modes.Mode.CLOUD)
    before = lrclib.cloud_lookup_queue()
    lrclib.use_cloud_lookup_queue(lrclib.LookupQueue(0.0, limiter=Bucket()))
    try:
        found = links.lrclib_lookup("Rex feat. Someone", "Leaving (Remastered)", "First", 200.4)
    finally:
        lrclib.use_cloud_lookup_queue(before)

    assert links.answer_of(found)[0] == "synced"
    assert taken == ["lrclib"] and len(requests) == 1
    sent = dict(requests[0].url.params)
    assert set(sent) == {"artist_name", "track_name", "duration", "album_name"}
    assert (sent["artist_name"], sent["duration"], sent["album_name"]) == ("Rex", "200", "First")
    assert requests[0].content == b""
