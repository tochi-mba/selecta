"""The Library knows both places (`library.places`, plan phase 2).

`GET /api/local-media/songs` says each song's copy in the cloud library (`cloud`), from
`store.cloud_copies`, only with the flag on and stored media readable for the account; the hosted
grant gates uploads, not reading, so an account whose grant was taken away still sees its cloud
songs (ADR-0456). Venue uploads and another workspace's uploads are never a song's copy.

`POST /api/assets/remove` removes songs from the cloud library by catalogue id: every copy of each
(its own hash and an older one), the bytes given back in one recount, and a word for each song on
whether it is now kept nowhere. Another account's song looks exactly like a missing one.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth

from selecta import flags
from selecta.billing.plans import DEFAULT_PLAN, plan_for
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.local_media.hashes_schema import local_song_hashes
from selecta.persistence import db_now, new_id, transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets
from selecta.usage import quota
from selecta.usage.schema import quota_state, usage_ledger
from selecta.work.schema import outbox_events

pytest_plugins = ("cloud_party",)


def sha(n: int) -> str:
    return f"{n:064x}"


@pytest.fixture
def places_on():
    flags.use("+cloud.local_media +library.places +devices")
    yield
    flags.use(None)


def _register(party, token: str, *numbers: int) -> list[int]:
    songs = [{"content_sha256": sha(n), "title": f"Song {n}", "artist": "Rex"} for n in numbers]
    answer = party.client.post("/api/local-media/songs", headers=auth(token), json={"songs": songs})
    assert answer.status_code == 200, answer.text
    return [entry["song_id"] for entry in answer.json()["songs"]]


def _asset(party, token: str, n: int, *, size: int = 1_000, venue: str | None = None) -> str:
    workspace = party.workspaces[token]
    asset_id = new_id()
    with transaction(party.engine, workspace) as conn:
        conn.execute(assets.insert().values(
            id=asset_id, workspace_id=workspace, original_key=original_key(workspace, asset_id),
            size=size, sha256=sha(n), format="flac", duration_s=200.0, created_at=db_now(conn),
            venue_id=venue,
        ))
    return asset_id


def _listed(party, token: str = ALICE) -> dict[int, dict]:
    answer = party.client.get("/api/local-media/songs?limit=1000", headers=auth(token))
    assert answer.status_code == 200, answer.text
    return {song["id"]: song for song in answer.json()["songs"]}


def _rule(party, flag_id: str, user_token: str, on: bool) -> None:
    user = party.client.get("/api/account", headers=auth(user_token)).json()["user"]["id"]
    with transaction(party.engine) as conn:
        flag_rules.save(conn, flag_id, [Rule(RuleKind.USERS, {"ids": [user], "on": on})],
                        author="tests", reason="places test")
    party.app.state.flag_rules.invalidate()


# -- the songs list's cloud field ---------------------------------------------------------------


def test_each_song_says_its_cloud_copy_and_null_when_it_has_none(party, places_on):
    kept, lonely = _register(party, ALICE, 1, 2)
    asset = _asset(party, ALICE, 1, size=4_000)
    listed = _listed(party)
    assert listed[kept]["cloud"] == {
        "asset_id": asset, "bytes": 4_000, "format": "flac", "copies": 1,
    }
    assert listed[lonely]["cloud"] is None
    # created_at was always there, for Newest first
    assert listed[kept]["created_at"] > 0


def test_without_the_flag_no_song_has_the_field(party):
    flags.use("+cloud.local_media")
    try:
        (song,) = _register(party, ALICE, 1)
        _asset(party, ALICE, 1)
        assert "cloud" not in _listed(party)[song]
    finally:
        flags.use(None)


def test_without_stored_media_for_the_account_no_song_has_the_field(party, places_on):
    (song,) = _register(party, ALICE, 1)
    _asset(party, ALICE, 1)
    _rule(party, "cloud.stored_media", ALICE, False)
    assert "cloud" not in _listed(party)[song]


def test_with_the_grant_taken_away_cloud_songs_still_say_their_copy(party, places_on):
    """The grant gates uploads, not reads (ADR-0456): the Library keeps showing them."""
    (song,) = _register(party, ALICE, 1)
    asset = _asset(party, ALICE, 1)
    _rule(party, "cloud.hosted_media", ALICE, False)
    assert _listed(party)[song]["cloud"]["asset_id"] == asset


def test_venue_uploads_and_other_accounts_uploads_are_never_a_copy(party, places_on):
    (mine,) = _register(party, ALICE, 1)
    _register(party, BOB, 1)
    _asset(party, ALICE, 1, venue="venue-1")
    _asset(party, BOB, 1)
    assert _listed(party)[mine]["cloud"] is None


def test_an_older_hash_and_a_second_copy_are_one_entry_with_both_counted(party, places_on):
    (song,) = _register(party, ALICE, 1)
    with transaction(party.engine, party.workspaces[ALICE]) as conn:
        conn.execute(local_song_hashes.insert().values(
            workspace_id=party.workspaces[ALICE], content_sha256=sha(77), song_id=song,
            created_at=db_now(conn),
        ))
    _asset(party, ALICE, 1, size=300)
    _asset(party, ALICE, 77, size=200)
    copy = _listed(party)[song]["cloud"]
    assert (copy["bytes"], copy["copies"]) == (500, 2)


# -- removing songs from the cloud library ------------------------------------------------------


def _remove(party, song_ids: list[int], token: str = ALICE):
    return party.client.post("/api/assets/remove", headers=auth(token), json={"song_ids": song_ids})


def _live(party, token: str, asset_id: str) -> bool:
    with transaction(party.engine, party.workspaces[token]) as conn:
        return conn.execute(
            sa.select(assets.c.deleted_at).where(assets.c.id == asset_id)
        ).scalar_one() is None


def test_removal_is_refused_with_the_flag_off(party):
    flags.use("+cloud.local_media")
    try:
        (song,) = _register(party, ALICE, 1)
        answer = _remove(party, [song])
        # the build guard answers before anything is read
        assert answer.status_code == 403, answer.text
        assert answer.json()["code"] == "flag_off"
        assert answer.json()["flag"] == "library.places"
    finally:
        flags.use(None)


def test_every_copy_goes_and_a_song_on_no_device_is_kept_nowhere(party, places_on):
    workspace = party.workspaces[ALICE]
    gone, held = _register(party, ALICE, 1, 2)
    with transaction(party.engine, workspace) as conn:
        conn.execute(local_song_hashes.insert().values(
            workspace_id=workspace, content_sha256=sha(77), song_id=gone,
            created_at=db_now(conn),
        ))
    first = _asset(party, ALICE, 1, size=300)
    older = _asset(party, ALICE, 77, size=200)
    other = _asset(party, ALICE, 2, size=50)
    device = party.register(ALICE, "Laptop")["device"]["id"]
    report = {"device_id": device, "present": [held], "absent": [], "snapshot": True}
    sent = party.client.post("/api/local-media/availability", headers=auth(ALICE), json=report)
    assert sent.status_code == 200, sent.text
    with transaction(party.engine, workspace) as conn:
        quota.set_limit(conn, workspace, plan_for(DEFAULT_PLAN))  # the row exists from here
        conn.execute(sa.update(quota_state).where(quota_state.c.workspace_id == workspace)
                     .values(committed_bytes=10_000))
        ledger_before = conn.execute(sa.select(sa.func.count()).select_from(usage_ledger)
                                     .where(usage_ledger.c.workspace_id == workspace)).scalar_one()

    answer = _remove(party, [gone, held])
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["songs"] == [
        {"id": gone, "found": True, "removed": 2, "left_nowhere": True},
        {"id": held, "found": True, "removed": 1, "left_nowhere": False},
    ]
    assert body["bytes_released"] == 550
    assert not _live(party, ALICE, first) and not _live(party, ALICE, older)
    assert not _live(party, ALICE, other)
    with transaction(party.engine, workspace) as conn:
        assert conn.execute(sa.select(quota_state.c.committed_bytes)
                            .where(quota_state.c.workspace_id == workspace)).scalar_one() == 9_450
        # one recount for the whole removal
        ledger_after = conn.execute(sa.select(sa.func.count()).select_from(usage_ledger)
                                    .where(usage_ledger.c.workspace_id == workspace)).scalar_one()
        assert ledger_after == ledger_before + 1
        topics = conn.execute(sa.select(outbox_events.c.topic)
                              .where(outbox_events.c.workspace_id == workspace)).scalars().all()
        assert topics.count("asset.removed") == 1
    # the catalogue songs themselves stay
    assert set(_listed(party)) >= {gone, held}


def test_another_accounts_song_looks_missing_and_is_untouched(party, places_on):
    (theirs,) = _register(party, BOB, 5)
    asset = _asset(party, BOB, 5)
    answer = _remove(party, [theirs])
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"songs": [{"id": theirs, "found": False}], "bytes_released": 0}
    assert _live(party, BOB, asset)


def test_a_song_with_no_copy_removes_nothing(party, places_on):
    (song,) = _register(party, ALICE, 3)
    answer = _remove(party, [song])
    assert answer.json()["songs"] == [
        {"id": song, "found": True, "removed": 0, "left_nowhere": True},
    ]


def test_the_request_is_held_to_200_songs_each_once(party, places_on):
    assert _remove(party, list(range(1, 202))).status_code == 422
    assert _remove(party, [1, 1]).status_code == 422
    assert _remove(party, []).status_code == 422


def test_a_copy_the_cloud_studio_has_not_measured_is_still_getting_ready(party, places_on):
    from selecta.hosted_render import analysis_hash
    from selecta.local_media import places
    from selecta.work.schema import artifacts

    workspace = party.workspaces[ALICE]
    waiting, measured = _register(party, ALICE, 1, 2)
    _asset(party, ALICE, 1)
    _asset(party, ALICE, 2)
    artifact = new_id()
    with transaction(party.engine, workspace) as conn:
        now = db_now(conn)
        # only the row's kind and input hash are read here; it is removed again below, as it
        # stands for a published analysis without its file
        conn.execute(artifacts.insert().values(
            id=artifact, workspace_id=workspace, kind="analysis", input_hash=analysis_hash(sha(2)),
            keys=[], checksum="c", provenance={"by": "tests"}, created_at=now, last_used_at=now,
        ))
        found = places.cloud_field(conn, workspace, [waiting, measured], measuring=True)
        # without the cloud studio nothing is ever measured, so nothing waits
        unmeasured = places.cloud_field(conn, workspace, [waiting], measuring=False)
        conn.execute(artifacts.delete().where(artifacts.c.id == artifact))
    assert found[waiting]["measuring"] is True
    assert "measuring" not in found[measured]
    assert "measuring" not in unmeasured[waiting]
