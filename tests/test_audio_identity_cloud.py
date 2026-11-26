"""The same song with new bytes in Cloud (`library.audio_identity`, docs/engineering/
audio-identity.md, "Cloud: the same song with new bytes").

A device registers a file hash the workspace hasn't seen with an audio id exactly one live song
has: that song stays, with its id and facts, and the new hash is recorded for it. Two or more
matches, or a deleted one, make a new song. A malformed audio id is refused; with the flag off the
field is dropped unread; one workspace's audio id never matches another's. On PostgreSQL the
recorded hashes are invisible to another workspace's transaction.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth

from selecta import flags
from selecta.engine_store.schema import analysis
from selecta.local_media import store
from selecta.local_media.hashes_schema import local_song_hashes
from selecta.local_media.schema import local_songs
from selecta.persistence import new_id, transaction

pytest_plugins = ("cloud_party",)

SHA_A, SHA_B, SHA_C = "a" * 64, "b" * 64, "c" * 64
AUDIO_X = "a1:" + "1" * 64
AUDIO_Y = "a1:" + "2" * 64


@pytest.fixture
def audio_on():
    flags.use("+cloud.local_media +library.audio_identity")
    yield
    flags.use(None)


@pytest.fixture
def audio_off():
    flags.use("+cloud.local_media -library.audio_identity")
    yield
    flags.use(None)


def song(sha: str, audio: str | None = None, title: str = "Night Drive") -> dict:
    found = {"content_sha256": sha, "title": title, "artist": "Rex"}
    return found if audio is None else {**found, "audio_id": audio}


def _register(party, token: str, songs: list[dict]) -> list[dict]:
    answer = party.client.post("/api/local-media/songs", headers=auth(token), json={"songs": songs})
    assert answer.status_code == 200, answer.text
    return answer.json()["songs"]


def _rows(party) -> list:
    with transaction(party.engine) as conn:
        return conn.execute(
            sa.select(
                local_songs.c.id, local_songs.c.content_sha256, local_songs.c.audio_id
            ).order_by(local_songs.c.id)
        ).all()


def _hashes(party) -> list:
    with transaction(party.engine) as conn:
        return conn.execute(
            sa.select(local_song_hashes.c.song_id, local_song_hashes.c.content_sha256)
        ).all()


def test_new_bytes_with_a_known_audio_id_stay_the_same_song(party, audio_on):
    [first] = _register(party, ALICE, [song(SHA_A, AUDIO_X)])
    with transaction(party.engine) as conn:
        workspace = conn.execute(
            sa.select(local_songs.c.workspace_id).where(local_songs.c.id == first["song_id"])
        ).scalar_one()
    with transaction(party.engine, workspace) as conn:
        conn.execute(
            analysis.insert().values(
                song_id=first["song_id"], workspace_id=workspace, version=1, bpm=121.0
            )
        )
    [retagged] = _register(party, ALICE, [song(SHA_B, AUDIO_X, "Night Drive (new tags)")])
    assert retagged == {"song_id": first["song_id"], "content_sha256": SHA_B}
    # the row keeps its own hash (an upload is stored under it) and learns the new one
    assert [(row.content_sha256, row.audio_id) for row in _rows(party)] == [(SHA_A, AUDIO_X)]
    assert _hashes(party) == [(first["song_id"], SHA_B)]
    with transaction(party.engine, workspace) as conn:
        assert conn.execute(sa.select(analysis.c.bpm)).scalar_one() == 121.0
    # the new bytes again, from another device, with or without the id: the same song
    assert _register(party, ALICE, [song(SHA_B)])[0]["song_id"] == first["song_id"]
    listed = party.client.get("/api/local-media/songs", headers=auth(ALICE)).json()["songs"]
    assert [entry["title"] for entry in listed] == ["Night Drive (new tags)"]


def test_an_ambiguous_audio_id_makes_a_new_song(party, audio_on):
    [a, b] = _register(party, ALICE, [song(SHA_A, AUDIO_X), song(SHA_B, AUDIO_Y, "Other")])
    with transaction(party.engine) as conn:
        conn.execute(
            local_songs.update().where(local_songs.c.id == b["song_id"]).values(audio_id=AUDIO_X)
        )
    [c] = _register(party, ALICE, [song(SHA_C, AUDIO_X)])
    assert c["song_id"] not in {a["song_id"], b["song_id"]}
    assert _hashes(party) == []


def test_a_deleted_match_makes_a_new_song(party, audio_on):
    [a] = _register(party, ALICE, [song(SHA_A, AUDIO_X)])
    party.client.delete(f"/api/local-media/songs/{a['song_id']}", headers=auth(ALICE))
    [b] = _register(party, ALICE, [song(SHA_B, AUDIO_X)])
    assert b["song_id"] != a["song_id"]


def test_an_older_song_learns_its_audio_id_but_never_changes_it(party, audio_on):
    [a] = _register(party, ALICE, [song(SHA_A)])
    assert _rows(party)[0].audio_id is None
    _register(party, ALICE, [song(SHA_A, AUDIO_X)])
    _register(party, ALICE, [song(SHA_A, AUDIO_Y)])
    assert [(row.id, row.audio_id) for row in _rows(party)] == [(a["song_id"], AUDIO_X)]


@pytest.mark.parametrize(
    "bad", ["a1:" + "A" * 64, "a2:" + "1" * 64, "a1:" + "1" * 63, "1" * 64, "", "a1:" + "g" * 64]
)
def test_a_malformed_audio_id_is_refused_and_nothing_is_registered(party, audio_on, bad):
    answer = party.client.post(
        "/api/local-media/songs",
        headers=auth(ALICE),
        json={"songs": [song(SHA_A, AUDIO_X), song(SHA_B, bad)]},
    )
    assert answer.status_code == 422
    assert _rows(party) == []


def test_with_the_flag_off_the_field_is_dropped_unread(party, audio_off):
    [a, b] = _register(party, ALICE, [song(SHA_A, AUDIO_X), song(SHA_B, AUDIO_X)])
    assert a["song_id"] != b["song_id"]
    [c] = _register(party, ALICE, [song(SHA_C, "not an audio id")])
    assert c["song_id"] not in {a["song_id"], b["song_id"]}
    assert all(row.audio_id is None for row in _rows(party))
    assert _hashes(party) == []


def test_one_workspaces_audio_id_never_matches_anothers(party, audio_on):
    [alice] = _register(party, ALICE, [song(SHA_A, AUDIO_X)])
    [bob] = _register(party, BOB, [song(SHA_B, AUDIO_X)])
    assert bob["song_id"] != alice["song_id"]
    assert _hashes(party) == []
    # and Bob's own copy of Alice's bytes is Bob's own song
    [bob_a] = _register(party, BOB, [song(SHA_A, AUDIO_X)])
    assert bob_a["song_id"] == bob["song_id"]
    assert bob_a["song_id"] != alice["song_id"]


def test_store_level_registration_ignores_audio_ids_unless_asked(sqlite_engine):
    workspace = new_id()
    with transaction(sqlite_engine, workspace) as conn:
        [a] = store.register_songs(conn, workspace, [song(SHA_A, AUDIO_X)])
        [b] = store.register_songs(conn, workspace, [song(SHA_B, AUDIO_X)])
    assert a["song_id"] != b["song_id"]
    with transaction(sqlite_engine, workspace) as conn:
        assert conn.execute(sa.select(local_songs.c.audio_id)).scalars().all() == [None, None]


def test_postgres_recorded_hashes_stay_in_their_workspace(postgres_engine):
    mine, theirs = new_id(), new_id()
    with transaction(postgres_engine, mine) as conn:
        [a] = store.register_songs(conn, mine, [song(SHA_A, AUDIO_X)], audio_ids=True)
        [b] = store.register_songs(conn, mine, [song(SHA_B, AUDIO_X)], audio_ids=True)
    assert a["song_id"] == b["song_id"]
    with transaction(postgres_engine, theirs) as conn:
        # deliberately no workspace filter: the policy is the only thing in the way
        assert conn.execute(sa.select(local_song_hashes)).all() == []
        [c] = store.register_songs(conn, theirs, [song(SHA_B, AUDIO_X)], audio_ids=True)
    assert c["song_id"] != a["song_id"]
    with transaction(postgres_engine, mine) as conn:
        assert conn.execute(sa.select(local_song_hashes.c.content_sha256)).scalars().all() == [
            SHA_B
        ]
