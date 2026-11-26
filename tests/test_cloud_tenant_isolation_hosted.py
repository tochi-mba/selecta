"""Tenant isolation for the hosted processing and catalogue routes, split from
`test_cloud_tenant_isolation.py` (which keeps the route matrix, its classification test and the
shared `world`): Bob, in his own workspace, names Alice's songs, jobs and covers, and every
answer is the one a made-up id gets, while nothing of hers changes.
"""

from __future__ import annotations

import sqlalchemy as sa
from test_cloud_tenant_isolation import ALICE, BOB, _auth, _rows_of, world  # noqa: F401

from selecta.persistence import db_now, new_id, transaction


def test_hosted_processing_never_reaches_another_accounts_songs(world):  # noqa: F811
    """Bob, in his own workspace, names Alice's song and her job: every hosted route answers as
    it does for made-up ids, queues nothing for her and touches none of her files."""
    from selecta.work.schema import jobs

    client, alice_song = world["client"], world["ids"]["asset_id"]
    made_up = new_id()

    def jobs_of(workspace_id):
        with world["engine"].connect() as conn:
            return conn.execute(
                sa.select(jobs.c.id).where(jobs.c.workspace_id == workspace_id)
            ).all()

    ready = client.post("/api/hosted/songs/prepare", headers=_auth(ALICE), json={})
    assert ready.status_code == 200, ready.text
    assert [song["asset_id"] for song in ready.json()["songs"]] == [alice_song]
    alice_jobs = jobs_of(world["alice_ws"])
    assert alice_jobs, "Alice's own song is queued for analysis (the positive control)"
    before = _rows_of(world["engine"], world["alice_ws"])
    world["objects"].touched.clear()

    listed = client.get("/api/hosted/songs", headers=_auth(BOB)).json()
    assert (listed["songs"], listed["total"]) == ([], 0)
    for path in ("/api/hosted/mixes/render", "/api/hosted/mixes/export"):
        theirs = client.post(path, headers=_auth(BOB), json={"songs": [
            {"asset_id": alice_song}, {"asset_id": alice_song}]})
        missing = client.post(path, headers=_auth(BOB), json={"songs": [
            {"asset_id": made_up}, {"asset_id": made_up}]})
        assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json()), path
    theirs = client.post(f"/api/hosted/songs/{alice_song}/retry", headers=_auth(BOB))
    missing = client.post(f"/api/hosted/songs/{made_up}/retry", headers=_auth(BOB))
    assert theirs.status_code == 404
    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
    planned = client.post("/api/hosted/mixes/plan", headers=_auth(BOB), json={"count": 4})
    # nothing of Alice's is planned or even counted for Bob
    assert planned.json() == {"songs": [], "considered": 0, "analysed": 0}
    theirs = client.get(f"/api/hosted/exports/{alice_jobs[0].id}", headers=_auth(BOB))
    missing = client.get(f"/api/hosted/exports/{made_up}", headers=_auth(BOB))
    assert theirs.status_code == 404
    assert theirs.json() == missing.json()
    assert jobs_of(world["bob_ws"]) == []
    assert _rows_of(world["engine"], world["alice_ws"]) == before
    assert not set(world["objects"].touched) & world["alice_keys"]


def test_the_export_by_catalogue_song_never_reaches_another_accounts_songs(world):  # noqa: F811
    """cloud.one_mixer: Bob names Alice's catalogue song for an export. Her upload is no cloud
    copy of his, so it is refused exactly as a made-up song id is, and nothing of hers is queued,
    read or changed; with the flag off the route reads songs by upload alone, as before."""
    import hashlib

    from selecta import flags
    from selecta.local_media.schema import local_songs
    from selecta.work.schema import jobs

    client, engine = world["client"], world["engine"]
    with transaction(engine, world["alice_ws"]) as conn:
        now = db_now(conn)
        alice_song = int(conn.execute(local_songs.insert().values(
            workspace_id=world["alice_ws"], title="Private Song", artist="Alice's Band",
            content_sha256=hashlib.sha256(b"alice's song").hexdigest(), created_at=now,
            updated_at=now).returning(local_songs.c.id)).scalar_one())

    def export(token, *ids):
        return client.post("/api/hosted/mixes/export", headers=_auth(token),
                           json={"songs": [{"song_id": song_id} for song_id in ids]})

    def jobs_of(workspace_id):
        with engine.connect() as conn:
            return conn.execute(sa.select(jobs.c.id).where(
                jobs.c.workspace_id == workspace_id)).all()

    mine = export(ALICE, alice_song, alice_song)
    # the positive control: her own song is read as her upload
    assert mine.status_code == 202, mine.text
    assert "missing" not in mine.json()
    before = _rows_of(engine, world["alice_ws"])
    world["objects"].touched.clear()

    made_up = alice_song + 10_000
    theirs, missing = export(BOB, alice_song, alice_song), export(BOB, made_up, made_up)
    assert (theirs.status_code, missing.status_code) == (202, 202)
    assert theirs.json() == {**missing.json(), "missing": [alice_song]}
    assert theirs.json()["state"] == "refused" and "Alice" not in theirs.text
    assert jobs_of(world["bob_ws"]) == []
    assert _rows_of(engine, world["alice_ws"]) == before
    assert not set(world["objects"].touched) & world["alice_keys"]

    flags.use(None)  # the build's defaults: cloud.one_mixer is off
    off = export(ALICE, alice_song, alice_song)
    assert (off.status_code, off.json()["detail"]["code"]) == (400, "invalid_songs")


def test_stored_exports_list_only_the_callers_own(world):  # noqa: F811
    """Alice's finished export is listed, with a link, for Alice alone: Bob's list is empty
    and nothing of hers is signed or changed (T-20261125-d37b)."""
    from selecta.storage.keys import derived_key
    from selecta.work.schema import artifacts

    client = world["client"]
    key = derived_key(world["alice_ws"], "export", "a" * 64, new_id(), "mix.flac")
    with transaction(world["engine"], world["alice_ws"]) as conn:
        now = db_now(conn)
        conn.execute(artifacts.insert().values(
            id=new_id(), workspace_id=world["alice_ws"], kind="export", input_hash="a" * 64,
            keys=[key], checksum="b" * 64, size_bytes=1234, provenance={"inputs": {}},
            created_at=now, last_used_at=now))
    mine = client.get("/api/stored/exports", headers=_auth(ALICE))
    assert mine.status_code == 200, mine.text
    [export] = mine.json()["exports"]  # the positive control
    assert export["size_bytes"] == 1234 and export["url"]
    before = _rows_of(world["engine"], world["alice_ws"])
    world["objects"].touched.clear()
    theirs = client.get("/api/stored/exports", headers=_auth(BOB))
    assert (theirs.status_code, theirs.json()) == (200, {"exports": []})
    assert _rows_of(world["engine"], world["alice_ws"]) == before
    assert key not in set(world["objects"].touched)


def _alice_catalogued_song(world) -> int:  # noqa: F811
    """Alice's library song, matched to a release with a stored cover, lookups on."""
    from selecta.catalog import match, service
    from selecta.catalog.schema import (
        catalog_art,
        catalog_lookups,
        catalog_recordings,
        catalog_releases,
        song_catalog_links,
    )
    from selecta.identity.schema import users
    from selecta.local_media.schema import local_songs

    release, recording = new_id(), new_id()
    key = match.lookup_key(match.Query("Alice's Band", "Private Song", None, 200.0, None))
    with transaction(world["engine"], world["alice_ws"]) as conn:
        now = db_now(conn)
        song_id = conn.execute(local_songs.insert().values(
            workspace_id=world["alice_ws"], content_sha256="e" * 64, title="Private Song",
            artist="Alice's Band", duration_s=200.0, created_at=now, updated_at=now,
        )).inserted_primary_key[0]
        conn.execute(catalog_lookups.insert().values(
            key=key, query={}, outcome="matched", method="search", confidence=0.9,
            recording_id=recording, release_id=release,
            candidates=[{"release_id": release}], created_at=now, updated_at=now))
        conn.execute(catalog_recordings.insert().values(
            id=recording, title="Private Song", artist="Alice's Band", isrcs=[],
            release_ids=[release], fetched_at=now))
        conn.execute(catalog_releases.insert().values(
            id=release, title="Alice's Album", secondary_types=[], fetched_at=now))
        conn.execute(catalog_art.insert().values(
            id=new_id(), release_id=release, source="caa",
            sizes={"500": f"{service.ART_PREFIX}x.jpg"}, content_type="image/jpeg",
            sha256="f" * 64, bytes=10, fetched_at=now))
        conn.execute(song_catalog_links.insert().values(
            workspace_id=world["alice_ws"], song_id=song_id, lookup_key=key,
            recording_id=recording, release_id=release, method="search", confidence=0.9,
            choice="auto", created_at=now, updated_at=now))
        alice = conn.execute(sa.select(users.c.id).where(
            users.c.auth_subject == "user_alice")).scalar()
        service.set_allowed(conn, alice, True)
    return int(song_id)


def test_catalog_never_reaches_another_accounts_songs(world):  # noqa: F811
    """Bob, in his own workspace, names Alice's catalogued song: covers, candidates and a
    choice answer exactly as for a song that doesn't exist, and nothing of hers changes."""
    from selecta.flags.rules import user_flag_preferences

    client = world["client"]
    song_id = _alice_catalogued_song(world)
    made_up = song_id + 10_000

    mine = client.post("/api/catalog/art", headers=_auth(ALICE),
                       json={"songs": [{"id": song_id}]})
    assert mine.status_code == 200, mine.text
    assert mine.json()["songs"][0]["state"] == "matched"  # the positive control
    assert client.get(f"/api/catalog/songs/{song_id}/candidates",
                      headers=_auth(ALICE)).status_code == 200
    before = _rows_of(world["engine"], world["alice_ws"])

    covers = client.post("/api/catalog/art", headers=_auth(BOB),
                         json={"songs": [{"id": song_id}, {"id": made_up}]})
    assert covers.status_code == 200, covers.text
    theirs, missing = covers.json()["songs"]
    assert {**theirs, "song_id": None} == {**missing, "song_id": None}
    assert theirs["state"] == "none" and "Alice" not in covers.text
    for method, path, body in (
        ("GET", "/api/catalog/songs/{}/candidates", None),
        ("PUT", "/api/catalog/songs/{}/choice", {"choice": "generated"}),
    ):
        theirs = client.request(method, path.format(song_id), headers=_auth(BOB), json=body)
        missing = client.request(method, path.format(made_up), headers=_auth(BOB), json=body)
        assert theirs.status_code == 404, theirs.text
        assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())

    # the lookups setting is each person's own
    assert client.get("/api/catalog/settings", headers=_auth(BOB)).json() == {"lookups": False}
    assert client.put("/api/catalog/settings", headers=_auth(BOB),
                      json={"lookups": False}).status_code == 200
    with world["engine"].connect() as conn:
        alices = conn.execute(sa.select(user_flag_preferences.c.enabled).where(
            user_flag_preferences.c.flag_id == "catalog:lookups",
            user_flag_preferences.c.user_id != conn.execute(
                sa.text("SELECT id FROM users WHERE auth_subject = 'user_bob'")).scalar(),
        )).scalars().all()
    assert alices == [True]
    assert _rows_of(world["engine"], world["alice_ws"]) == before
