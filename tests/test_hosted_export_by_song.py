"""The cloud library export by catalogue song id (`hosted_export.request_song_export`, plan phase 4,
`cloud.one_mixer`).

A mix made with the shared mixer names its songs by catalogue id. Each is read as its cloud copy
(`local_media.store.cloud_copies`: a live upload of the same workspace with one of the song's
hashes), then the export is the one the cloud card made, with the same join, allowance and storage
rules. Another workspace's song has no copy here, so it is refused exactly as a made-up id is, and
nothing is asked for. The older form, by upload id, is unchanged.
"""

from __future__ import annotations

import hashlib

import pytest
import sqlalchemy as sa
from test_hosted_stuck_jobs import hosted, song  # noqa: F401 - the shared hosted fixture

from selecta import flags, hosted_export
from selecta.identity.schema import users, workspaces
from selecta.local_media.schema import local_songs
from selecta.persistence import new_id, transaction
from selecta.usage.schema import allowance_counters
from selecta.work.schema import jobs


def _catalogue(engine, workspace: str, body: bytes, title: str) -> int:
    """A catalogue song whose file hash is `body`'s, as a device registers it."""
    with transaction(engine, workspace) as conn:
        return int(conn.execute(local_songs.insert().values(
            workspace_id=workspace, content_sha256=hashlib.sha256(body).hexdigest(), title=title,
            artist="Rex", created_at=1, updated_at=1,
        ).returning(local_songs.c.id)).scalar_one())


def _other_workspace(engine) -> str:
    workspace, user = new_id(), new_id()
    with transaction(engine) as conn:
        conn.execute(users.insert().values(
            id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
            age_confirmed=True, created_at=0.0))
        conn.execute(workspaces.insert().values(
            id=workspace, name="Theirs", kind="personal", owner_user_id=user, created_at=0.0))
    return workspace


def _count(engine, workspace: str, table, *where) -> int:
    with transaction(engine, workspace) as conn:
        return int(conn.execute(sa.select(sa.func.count()).select_from(table).where(
            table.c.workspace_id == workspace, *where)).scalar_one())


@pytest.fixture
def asked(monkeypatch):
    """The orders `mix_state` is asked for; it answers a complete two-song mix."""
    seen: list[list[dict]] = []

    def mix_state(_engine, _work, workspace, order, **_kwargs):
        seen.append([dict(item) for item in order])
        return {"complete": True, "counts": {}, "parts": [
            {"kind": "song", "from_s": 0.0, "seconds": 30.0, "gain_db": 0.0,
             "_file": {"key": f"w/{workspace}/a/{item['asset_id']}", "sha256": f"{n:064x}"}}
            for n, item in enumerate(order, start=1)]}

    monkeypatch.setattr(hosted_export.hosted_render, "mix_state", mix_state)
    return seen


def test_songs_named_by_catalogue_id_export_from_their_cloud_copies(hosted, asked):  # noqa: F811
    engine, work, workspace = hosted
    one, two = song(engine, workspace, b"one"), song(engine, workspace, b"two")
    first, second = _catalogue(engine, workspace, b"one", "One"), _catalogue(engine, workspace,
                                                                             b"two", "Two")
    made = hosted_export.request_song_export(
        engine, work, workspace, [{"song_id": first, "move": None},
                                  {"song_id": second, "move": "blend"}],
        client=None, buckets=None)
    assert made["state"] == "queued" and made["job_id"]
    # the same export the card asks for: by upload, in order, with each move
    assert asked == [[{"asset_id": one["id"], "move": None},
                      {"asset_id": two["id"], "move": "blend"}]]
    assert _count(engine, workspace, jobs, jobs.c.type == "export.render") == 1
    # one of the plan's exports this month, as for the card's export
    assert _count(engine, workspace, allowance_counters,
                  allowance_counters.c.kind == "export") == 1


def test_another_workspaces_song_is_refused_as_a_made_up_one_and_nothing_is_asked(hosted,  # noqa: F811
                                                                                   asked):
    engine, work, workspace = hosted
    theirs = _other_workspace(engine)
    song(engine, theirs, b"theirs")
    their_song = _catalogue(engine, theirs, b"theirs", "Theirs")
    mine = _catalogue(engine, workspace, b"mine, with no upload", "Mine")
    # their upload shares my song's bytes, and still isn't my cloud copy
    shared = _catalogue(engine, workspace, b"theirs", "Same bytes")
    for ids in ([their_song, their_song], [987_654, 987_654], [mine, shared]):
        answer = hosted_export.request_song_export(
            engine, work, workspace, [{"song_id": i, "move": None} for i in ids],
            client=None, buckets=None)
        assert answer == {"state": "refused", "why": hosted_export.NOT_IN_CLOUD,
                          "missing": list(dict.fromkeys(ids))}
    assert asked == []
    for owner in (workspace, theirs):
        assert _count(engine, owner, jobs) == 0
        assert _count(engine, owner, allowance_counters) == 0


def test_a_mix_still_being_made_says_how_far_it_has_got(hosted, monkeypatch):  # noqa: F811
    engine, work, workspace = hosted
    song(engine, workspace, b"a")
    song(engine, workspace, b"b")
    ids =[_catalogue(engine, workspace, b"a", "A"), _catalogue(engine, workspace, b"b", "B")]
    counts = {"seams_ready": 0, "seams_failed": 0, "seams": 1, "songs_analysed": 1, "songs": 2,
              "files_ready": 1}
    parts = [{"kind": "song", "from_s": 0.0, "seconds": 30.0, "_file": {}}] * 2
    monkeypatch.setattr(hosted_export.hosted_render, "mix_state", lambda *a, **k: {
        "complete": False, "parts": parts, "counts": counts, "estimate_s": 40,
        "worker_seen": True})
    answer = hosted_export.request_song_export(
        engine, work, workspace, [{"song_id": i, "move": None} for i in ids], client=None,
        buckets=None)
    assert answer == {"state": "preparing", "counts": counts, "estimate_s": 40,
                      "worker_seen": True}
    # the older form still refuses a mix that isn't ready, as before
    order = [{"asset_id": "one"}, {"asset_id": "two"}]
    assert hosted_export.request_export(engine, work, workspace, order, client=None,
                                        buckets=None) == {"state": "refused",
                                                          "why": hosted_export.NOT_READY}
    assert _count(engine, workspace, jobs, jobs.c.type == "export.render") == 0


def test_catalogue_songs_are_read_only_with_the_flag_and_only_when_well_formed():
    by_song = [{"song_id": 3}, {"song_id": 4, "move": "blend"}]
    assert hosted_export.songs_named(by_song) is None  # off by default: the route reads as before
    flags.use("+cloud.one_mixer")
    assert hosted_export.songs_named(by_song) == [{"song_id": 3, "move": None},
                                                  {"song_id": 4, "move": "blend"}]
    # the older form, and anything mixed, is left to the route's own reading
    assert hosted_export.songs_named([{"asset_id": "a"}, {"asset_id": "b"}]) is None
    assert hosted_export.songs_named([{"song_id": 3}, {"asset_id": "b"}]) is None
    assert hosted_export.songs_named([]) is None
    for bad in ([{"song_id": True}], [{"song_id": -1}], [{"song_id": "3"}], [{"song_id": 2**63}],
                [{"song_id": n} for n in range(1, hosted_export.MAX_SONGS + 2)]):
        with pytest.raises(ValueError, match="invalid_songs"):
            hosted_export.songs_named(bad)
    with pytest.raises(ValueError, match="invalid_move"):
        hosted_export.songs_named([{"song_id": 3, "move": "../x"}])
