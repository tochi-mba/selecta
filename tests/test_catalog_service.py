"""Asking for catalogue lookups, the lookup job, and reading what it found (ADR-0478).

MusicBrainz and the Cover Art Archive are replayed from hand-written fixtures
(`catalog_kit.Replay`), and covers land in the in-memory `FakeS3`.
"""

from __future__ import annotations

import time

import httpx
import pytest
import sqlalchemy as sa
from catalog_kit import ALBUM, ISRC, RECORDING, SINGLE, Replay, add_song, isrc_replay, musicbrainz
from test_cloud_storage_fakes import FakeS3

from selecta import flags
from selecta.catalog import client, service
from selecta.catalog.schema import catalog_art, catalog_lookups, song_catalog_links
from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.work.schema import jobs

BUCKET = "derived"


@pytest.fixture(autouse=True)
def lookups_on():
    flags.use("+library.art_embedded +library.art_lookup")
    saved = client.process_gate()
    client.use_gate(client.Gate(0.0, sleep=lambda _s: None))
    yield
    client.use_gate(saved)


def person(engine, name: str, *, allows: bool = True) -> tuple[str, str]:
    now = time.time()
    claims = Claims(f"subject-{name}", now, now + 3000, email=f"{name}@example.test",
                    email_verified=True)
    with transaction(engine) as conn:
        principal = accounts.provision(conn, claims, age_confirmed=True)
        if allows:
            service.set_allowed(conn, principal.user.id, True)
    return principal.user.id, principal.workspace.id


def link(engine, workspace_id: str, song_id: int):
    with transaction(engine, workspace_id) as conn:
        return conn.execute(sa.select(song_catalog_links).where(
            song_catalog_links.c.workspace_id == workspace_id,
            song_catalog_links.c.song_id == song_id)).first()


def lookup_row(engine, key: str):
    with transaction(engine) as conn:
        return conn.execute(sa.select(catalog_lookups).where(catalog_lookups.c.key == key)).first()


def lookup_jobs(engine) -> list:
    with transaction(engine) as conn:
        return list(conn.execute(sa.select(jobs.c.workspace_id, jobs.c.idempotency_key)
                                 .where(jobs.c.type == service.JOB_TYPE)))


def make_due(engine, key: str) -> None:
    with transaction(engine) as conn:
        conn.execute(catalog_lookups.update().where(catalog_lookups.c.key == key)
                     .values(next_retry_at=db_now(conn) - 1))


def art(engine, workspace_id: str, song_id: int) -> dict:
    with transaction(engine, workspace_id) as conn:
        return service.art_for_songs(conn, workspace_id, [song_id])[0]


class Run:
    def __init__(self, engine, replay: Replay) -> None:
        self.engine, self.replay, self.objects = engine, replay, FakeS3()

    def __call__(self, key: str) -> dict:
        with musicbrainz(self.replay) as mb:
            return service.run_lookup(self.engine, key, musicbrainz=mb, objects=self.objects,
                                      bucket=BUCKET)


def ask(engine, user_id: str, workspace_id: str, song_id: int, isrc: str | None = ISRC) -> str:
    assert service.enqueue_for_song(engine, workspace_id, user_id, song_id, isrc=isrc)
    return link(engine, workspace_id, song_id).lookup_key


def test_one_lookup_fills_the_links_in_two_workspaces(cloud_engine):
    alice, alice_ws = person(cloud_engine, "alice")
    bob, bob_ws = person(cloud_engine, "bob")
    alice_song, bob_song = add_song(cloud_engine, alice_ws), add_song(cloud_engine, bob_ws)
    key = ask(cloud_engine, alice, alice_ws, alice_song)
    assert ask(cloud_engine, bob, bob_ws, bob_song) == key
    run = Run(cloud_engine, isrc_replay())

    assert run(key) == {"outcome": "matched", "method": "isrc", "cover": True}
    assert run.replay.paths() == [f"/ws/2/isrc/{ISRC}", f"/ws/2/recording/{RECORDING}",
                                  f"/release/{ALBUM}/front-500"]
    seen = [art(cloud_engine, alice_ws, alice_song), art(cloud_engine, bob_ws, bob_song)]
    assert [s["state"] for s in seen] == ["matched", "matched"]
    assert seen[0]["art"]["id"] == seen[1]["art"]["id"]
    assert seen[0]["art"]["url"] == f"/api/catalog/art/{seen[0]['art']['id']}/500"
    assert seen[0]["details"] == {
        "recording_id": RECORDING, "release_id": ALBUM, "title": "Lanterns Over the Water",
        "artist": "Night Harbour", "album": "Low Tide", "year": 2024, "isrc": ISRC,
    }
    assert seen[0]["method"] == "isrc" and seen[0]["confidence"] == 1.0
    [(_, stored)] = [k for k in run.objects.objects if k[0] == BUCKET]
    assert stored.startswith(service.ART_PREFIX) and stored.endswith("/500.jpg")


def test_the_job_is_idempotent(cloud_engine):
    user, ws = person(cloud_engine, "alice")
    song = add_song(cloud_engine, ws)
    key = ask(cloud_engine, user, ws, song)
    assert service.enqueue_for_song(cloud_engine, ws, user, song, isrc=ISRC)
    assert len(lookup_jobs(cloud_engine)) == 1, "an unfinished job for the key is reused"
    run = Run(cloud_engine, isrc_replay())
    run(key)
    asked = len(run.replay.requests)

    assert run(key) == {"skipped": "not_due"}
    assert len(run.replay.requests) == asked
    assert not service.enqueue_for_song(cloud_engine, ws, user, song, isrc=ISRC)
    make_due(cloud_engine, key)
    assert run(key)["outcome"] == "matched"
    assert run.replay.paths()[asked:] == [f"/ws/2/isrc/{ISRC}", f"/ws/2/recording/{RECORDING}"]
    with transaction(cloud_engine) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(catalog_art)).scalar() == 1


@pytest.mark.parametrize(
    ("replay", "outcome"),
    [
        (Replay({"/ws/2/recording": "search_empty"}), "no_match"),
        (Replay({"/ws/2/recording": "search_two_close_songs"}), "ambiguous"),
        (Replay({"/ws/2/": lambda _r: httpx.Response(500)}), "error"),
    ],
)
def test_a_miss_or_an_error_is_not_asked_again_before_its_retry_time(cloud_engine, replay,
                                                                     outcome):
    user, ws = person(cloud_engine, "alice")
    song = add_song(cloud_engine, ws, title="Lanterns", seconds=200.0)
    key = ask(cloud_engine, user, ws, song, isrc=None)
    run = Run(cloud_engine, replay)

    assert run(key)["outcome"] == outcome
    row = lookup_row(cloud_engine, key)
    assert row.outcome == outcome and row.attempts == 1
    with transaction(cloud_engine) as conn:
        wait = float(row.next_retry_at) - db_now(conn)
    expected = service.RETRY_ERROR_BASE_S if outcome == "error" else service.RETRY_NO_MATCH_S
    assert expected - 60 < wait <= expected
    assert (row.last_error is not None) is (outcome == "error")
    assert art(cloud_engine, ws, song)["state"] == "none"

    asked = len(replay.requests)
    assert not service.enqueue_for_song(cloud_engine, ws, user, song)
    assert run(key) == {"skipped": "not_due"}
    assert len(replay.requests) == asked

    make_due(cloud_engine, key)
    assert service.enqueue_for_song(cloud_engine, ws, user, song)
    assert run(key)["outcome"] == outcome
    assert lookup_row(cloud_engine, key).attempts == 2


def test_errors_back_off_longer_each_time_up_to_a_week(cloud_engine):
    def broken(request):
        raise httpx.ConnectError("down", request=request)

    user, ws = person(cloud_engine, "alice")
    key = ask(cloud_engine, user, ws, add_song(cloud_engine, ws), isrc=None)
    run = Run(cloud_engine, Replay({"/": broken}))
    waits = []
    for _ in range(10):
        run(key)
        row = lookup_row(cloud_engine, key)
        waits.append(float(row.next_retry_at) - float(row.updated_at))
        make_due(cloud_engine, key)

    assert waits[:3] == [3600.0, 7200.0, 14400.0]
    assert waits[-1] == service.RETRY_ERROR_MAX_S
    assert "ConnectError" in lookup_row(cloud_engine, key).last_error


def test_a_persons_choice_survives_a_rerun(cloud_engine):
    user, ws = person(cloud_engine, "alice")
    first, second = add_song(cloud_engine, ws), add_song(cloud_engine, ws, seconds=241.4)
    key = ask(cloud_engine, user, ws, first)
    assert ask(cloud_engine, user, ws, second) == key
    run = Run(cloud_engine, isrc_replay())
    run(key)

    with transaction(cloud_engine, ws) as conn:
        offered = service.candidates_for_song(conn, ws, first)
        assert {r["release_id"] for r in offered["releases"]} >= {ALBUM, SINGLE}
        assert [r["release_id"] for r in offered["releases"] if r["current"]] == [ALBUM]
        assert service.set_choice(conn, ws, first, user, choice="generated") is None
        needs = service.set_choice(conn, ws, second, user, choice="release", release_id=SINGLE)
        with pytest.raises(ValueError):
            service.set_choice(conn, ws, second, user, choice="release",
                               release_id="ffffffff-0000-4000-8000-000000000000")
    assert needs == SINGLE, "the single's cover was never fetched"
    with musicbrainz(run.replay) as mb:
        assert service.fetch_release_cover(cloud_engine, SINGLE, musicbrainz=mb,
                                           objects=run.objects, bucket=BUCKET)

    make_due(cloud_engine, key)
    assert run(key)["outcome"] == "matched"
    assert art(cloud_engine, ws, first)["state"] == "generated"
    chosen = art(cloud_engine, ws, second)
    assert chosen["chosen"] is True and chosen["details"]["release_id"] == SINGLE
    assert chosen["art"] is not None
    assert link(cloud_engine, ws, second).release_id == ALBUM, "the lookup still records its own"


def test_nothing_is_queued_while_the_flag_is_off(cloud_engine):
    user, ws = person(cloud_engine, "alice")
    song = add_song(cloud_engine, ws)
    flags.use(None)

    assert not service.enqueue_for_song(cloud_engine, ws, user, song, isrc=ISRC)
    assert link(cloud_engine, ws, song) is None and lookup_jobs(cloud_engine) == []
    assert service.run_lookup(cloud_engine, "0" * 64) == {"skipped": "flag_off"}


def test_nothing_is_queued_while_the_persons_setting_is_off(cloud_engine):
    user, ws = person(cloud_engine, "alice", allows=False)
    song = add_song(cloud_engine, ws)

    assert not service.enqueue_for_song(cloud_engine, ws, user, song, isrc=ISRC)
    assert link(cloud_engine, ws, song) is None and lookup_jobs(cloud_engine) == []
    with transaction(cloud_engine) as conn:
        assert service.allowed(conn, user) is False
        service.set_allowed(conn, user, True)
        assert service.allowed(conn, user) is True
    assert service.enqueue_for_song(cloud_engine, ws, user, song, isrc=ISRC)


def test_a_song_with_nothing_to_search_with_asks_for_nothing(cloud_engine):
    user, ws = person(cloud_engine, "alice")
    song = add_song(cloud_engine, ws, seconds=None)

    assert not service.enqueue_for_song(cloud_engine, ws, user, song, isrc="not an isrc")
    assert not service.enqueue_for_song(cloud_engine, ws, user, 999_999)
    assert lookup_jobs(cloud_engine) == []


def test_a_hidden_image_is_never_returned(cloud_engine):
    user, ws = person(cloud_engine, "alice")
    song = add_song(cloud_engine, ws)
    key = ask(cloud_engine, user, ws, song)
    Run(cloud_engine, isrc_replay())(key)
    art_id = art(cloud_engine, ws, song)["art"]["id"]
    with transaction(cloud_engine) as conn:
        assert service.read_art(conn, art_id, "500") is not None
        conn.execute(catalog_art.update().where(catalog_art.c.id == art_id).values(hidden=True))

    seen = art(cloud_engine, ws, song)
    assert seen["state"] == "matched" and seen["art"] is None
    with transaction(cloud_engine, ws) as conn:
        offered = service.candidates_for_song(conn, ws, song)["releases"]
        assert all(r["art"] is None for r in offered)
        assert service.read_art(conn, art_id, "500") is None
        assert service.read_art(conn, art_id, "1200") is None


def test_the_job_handler_needs_a_database_and_a_key(monkeypatch):
    class Job:
        input_ref = {"key": "short"}

    monkeypatch.delenv("SELECTA_DATABASE_URL", raising=False)
    assert service.handle_job(Job(), None) == {"skipped": "no_database"}
    assert service.handlers() == {service.JOB_TYPE: service.handle_job}


# --- consent at the moment of sending (T-20261125-c9ae) ----------------------------------------


def queued_job(engine, user_id: str):
    """The one lookup job the person queued, as the worker would see it."""
    from selecta.work.store import JobStore

    with transaction(engine) as conn:
        job_id = conn.execute(sa.select(jobs.c.id).where(
            jobs.c.type == service.JOB_TYPE, jobs.c.created_by == user_id)).scalar_one()
    return JobStore(engine).job(job_id)


def asker_of(job) -> service.Asker:
    return service.Asker(job.workspace_id, job.created_by, float(job.created_at))


def run_as(engine, key: str, replay: Replay, asker: service.Asker | None) -> dict:
    with musicbrainz(replay) as mb:
        return service.run_lookup(engine, key, musicbrainz=mb, objects=FakeS3(), bucket=BUCKET,
                                  asker=asker)


def test_a_queued_job_sends_nothing_once_the_person_turns_lookups_off(cloud_engine):
    user, ws = person(cloud_engine, "alice")
    key = ask(cloud_engine, user, ws, add_song(cloud_engine, ws))
    job = queued_job(cloud_engine, user)
    with transaction(cloud_engine) as conn:
        service.set_allowed(conn, user, False)
    replay = isrc_replay()

    assert run_as(cloud_engine, key, replay, asker_of(job)) == {"skipped": "no_consent"}
    assert run_as(cloud_engine, key, replay, None) == {"skipped": "no_consent"}
    assert replay.requests == [], "no song details left the server"
    row = lookup_row(cloud_engine, key)
    assert row.outcome == "pending" and row.attempts == 0, "the key is left for a later ask"


def test_turning_lookups_off_cancels_the_persons_queued_jobs(cloud_engine):
    from selecta.work.model import JobState

    user, ws = person(cloud_engine, "alice")
    other, other_ws = person(cloud_engine, "bob")
    ask(cloud_engine, user, ws, add_song(cloud_engine, ws))
    ask(cloud_engine, other, other_ws, add_song(cloud_engine, other_ws, title="Other Song"))
    with transaction(cloud_engine) as conn:
        service.set_allowed(conn, user, False)

    assert service.cancel_lookups(cloud_engine, user) == 1
    assert queued_job(cloud_engine, user).state == JobState.CANCELLED
    assert queued_job(cloud_engine, other).state != JobState.CANCELLED, "only that person's"
    assert service.cancel_lookups(cloud_engine, user) == 0, "safe to repeat"


def test_a_retry_after_turning_lookups_off_sends_nothing(cloud_engine):
    user, ws = person(cloud_engine, "alice")
    key = ask(cloud_engine, user, ws, add_song(cloud_engine, ws), isrc=None)
    asker = asker_of(queued_job(cloud_engine, user))
    broken = Replay({"/ws/2/": lambda _r: httpx.Response(500)})
    assert run_as(cloud_engine, key, broken, asker)["outcome"] == "error"
    asked = len(broken.requests)
    make_due(cloud_engine, key)
    with transaction(cloud_engine) as conn:
        service.set_allowed(conn, user, False)

    assert run_as(cloud_engine, key, broken, asker) == {"skipped": "no_consent"}
    assert len(broken.requests) == asked
    assert lookup_row(cloud_engine, key).attempts == 1


def test_nothing_is_sent_for_a_deleted_song(cloud_engine):
    from selecta.local_media.schema import local_songs

    user, ws = person(cloud_engine, "alice")
    song = add_song(cloud_engine, ws)
    key = ask(cloud_engine, user, ws, song)
    asker = asker_of(queued_job(cloud_engine, user))
    with transaction(cloud_engine, ws) as conn:
        conn.execute(local_songs.update().where(local_songs.c.id == song)
                     .values(deleted_at=db_now(conn)))
    replay = isrc_replay()

    assert run_as(cloud_engine, key, replay, asker) == {"skipped": "no_consent"}
    assert replay.requests == []


def test_nothing_is_sent_for_a_deleted_or_signed_out_account(cloud_engine):
    from selecta.identity.schema import users

    user, ws = person(cloud_engine, "alice")
    key = ask(cloud_engine, user, ws, add_song(cloud_engine, ws))
    asker = asker_of(queued_job(cloud_engine, user))
    replay = isrc_replay()
    with transaction(cloud_engine) as conn:
        accounts.revoke_sessions(conn, user)
    assert run_as(cloud_engine, key, replay, asker) == {"skipped": "no_consent"}, "signed out"

    with transaction(cloud_engine) as conn:
        conn.execute(users.update().where(users.c.id == user).values(deleted_at=db_now(conn)))
    assert run_as(cloud_engine, key, replay, None) == {"skipped": "no_consent"}, "deleted"
    assert replay.requests == []


def test_a_job_runs_on_its_askers_consent_not_someone_elses(cloud_engine):
    alice, alice_ws = person(cloud_engine, "alice")
    bob, bob_ws = person(cloud_engine, "bob")
    key = ask(cloud_engine, alice, alice_ws, add_song(cloud_engine, alice_ws))
    assert ask(cloud_engine, bob, bob_ws, add_song(cloud_engine, bob_ws)) == key
    alices_job = asker_of(queued_job(cloud_engine, alice))
    with transaction(cloud_engine) as conn:
        service.set_allowed(conn, alice, False)
    replay = isrc_replay()

    assert run_as(cloud_engine, key, replay, alices_job) == {"skipped": "no_consent"}
    assert replay.requests == []
    bobs_job = asker_of(queued_job(cloud_engine, bob))
    assert run_as(cloud_engine, key, replay, bobs_job)["outcome"] == "matched"


def test_a_picked_release_cover_is_fetched_only_with_consent(cloud_engine):
    user, ws = person(cloud_engine, "alice")
    song = add_song(cloud_engine, ws)
    key = ask(cloud_engine, user, ws, song)
    run = Run(cloud_engine, isrc_replay())
    run(key)
    with transaction(cloud_engine, ws) as conn:
        assert service.set_choice(conn, ws, song, user, choice="release",
                                  release_id=SINGLE) == SINGLE
        service.set_allowed(conn, user, False)

    assert service.queue_cover_fetch(cloud_engine, ws, user, SINGLE) is False
    with transaction(cloud_engine) as conn:
        assert not conn.execute(sa.select(jobs.c.id).where(
            jobs.c.idempotency_key == f"cover:{SINGLE}")).first()
    asked = len(run.replay.requests)
    with musicbrainz(run.replay) as mb:
        assert not service.fetch_release_cover(
            cloud_engine, SINGLE, musicbrainz=mb, objects=run.objects, bucket=BUCKET,
            asker=service.Asker(ws, user))
    assert len(run.replay.requests) == asked
