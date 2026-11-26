"""Cloud planning routes over song facts (`cloud.brain`, docs/engineering/cloud-planning.md).

Two signed-up accounts over in-memory object storage. Alice's device saves facts for her songs;
the planning answers equal what the planner core gives Desktop for the same `SongInfo`s (built
directly from the same numbers, compared through JSON); Bob can't read, write or plan with
Alice's songs; every route answers `flag_off` with the flag off; the export carries the engine
tables and the arrays, and account deletion's sweep covers them. Synthetic numbers, no audio.
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from brain_helpers import facts_body, sha_for, song_info
from cloud_helpers import cloud_settings
from cloud_world import CloudObjects, use_fake_storage
from fastapi.testclient import TestClient

from selecta import flags
from selecta.api_cloud import create_cloud_app
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import make_engine, metadata, migrate, new_id
from selecta.planner_core.choose import enumerate_candidates, fallback_candidate
from selecta.planner_core.memory import SeamMemory
from selecta.planner_core.repair import (
    MAX_REPAIRS,
    Attempted,
    AuditFacts,
    FailedCheck,
    Option,
    next_step,
    take_step,
)
from selecta.planner_core.vibes import build_vibe, resolve_vibe, traits_of
from selecta.render.script_json import to_dict

ALICE, BOB = "alice-token", "bob-token"
SEEDS = (1, 2, 3, 4, 5, 6, 7, 8)
TEMPOS = (120.0, 121.0, 119.0, 122.0, 120.5, 118.5, 121.5, 120.0)


class People:
    def __init__(self) -> None:
        self.claims = {
            token: Claims(
                subject=f"user_{token}",
                issued_at=1_000,
                expires_at=4_000_000_000,
                email=f"{token}@example.test",
                email_verified=True,
            )
            for token in (ALICE, BOB)
        }

    def verify(self, token: str) -> Claims:
        try:
            return self.claims[token]
        except KeyError:
            raise BadSignature("unknown test token") from None


def _auth(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Origin": "https://app.test",
        "Idempotency-Key": new_id(),
    }


def _norm(value):
    return json.loads(json.dumps(value))


@pytest.fixture
def cloud(tmp_path, monkeypatch):
    objects = CloudObjects()
    use_fake_storage(monkeypatch, objects)
    engine = make_engine(f"sqlite:///{tmp_path / 'cloud.sqlite'}")
    migrate.upgrade(engine)
    app = create_cloud_app(cloud_settings(), engine=engine, verifier=People())
    try:
        with TestClient(app) as client:
            for token in (ALICE, BOB):
                made = client.post(
                    "/api/onboarding/complete", headers=_auth(token), json={"age_confirmed": True}
                )
                assert made.status_code == 201, made.text
            songs = [
                {
                    "content_sha256": sha_for(seed),
                    "title": f"Song {seed}",
                    "artist": f"Artist {seed}",
                    "duration_s": 200.0,
                }
                for seed in (*SEEDS, 99)
            ]
            registered = client.post(
                "/api/local-media/songs", headers=_auth(ALICE), json={"songs": songs}
            )
            assert registered.status_code == 200, registered.text
            ids = [answer["song_id"] for answer in registered.json()["songs"]]
            for song_id, seed, bpm in zip(ids, SEEDS, TEMPOS, strict=False):
                saved = client.put(
                    f"/api/song-facts/{song_id}",
                    headers=_auth(ALICE),
                    json=facts_body(seed, sha=sha_for(seed), bpm=bpm),
                )
                assert saved.status_code == 200, saved.text
            yield {"client": client, "ids": ids[: len(SEEDS)], "unmeasured": ids[-1],
                   "engine": engine}
    finally:
        engine.dispose()


def _infos(ids: list[int]) -> list:
    return [
        song_info(song_id, seed, title=f"Song {seed}", artist=f"Artist {seed}", bpm=bpm)
        for song_id, seed, bpm in zip(ids, SEEDS, TEMPOS, strict=False)
    ]


def _expected_entry(index, candidate, a, b, scripted):
    entry = {
        "index": index,
        "option": Option.of(candidate).to_json(),
        "score": candidate.score,
        "reasons": list(candidate.reasons),
    }
    if scripted:
        script = candidate.recipe.make(
            a, b, candidate.exit_cue, candidate.entry_cue, candidate.bars
        )
        entry["script"] = None if script is None else to_dict(script)
        entry["has_script"] = script is not None
    return entry


def test_seam_candidates_equal_the_desktop_planners_for_the_same_facts(cloud):
    first, second = cloud["ids"][:2]
    answer = cloud["client"].post(
        "/api/planning/candidates", headers=_auth(ALICE), json={"a": first, "b": second}
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    a, b = _infos(cloud["ids"])[:2]
    pool = enumerate_candidates(a, b, None, exits=None)[:300]
    assert body["options"] == _norm(
        [_expected_entry(i, c, a, b, i < 8) for i, c in enumerate(pool)]
    )
    assert body["fallback"] == _norm(_expected_entry(-1, fallback_candidate(a, b), a, b, True))
    assert (body["schema"], body["max_repairs"]) == (1, MAX_REPAIRS)
    if len(pool) > 8:
        more = cloud["client"].post(
            "/api/planning/candidates/script",
            headers=_auth(ALICE),
            json={"a": first, "b": second, "option": 8, "fingerprint": body["fingerprint"]},
        )
        assert more.status_code == 200, more.text
        assert more.json() == _norm(_expected_entry(8, pool[8], a, b, True))
    stale = cloud["client"].post(
        "/api/planning/candidates/script",
        headers=_auth(ALICE),
        json={"a": first, "b": second, "option": 0, "fingerprint": "0" * 64},
    )
    assert (stale.status_code, stale.json()["detail"]["code"]) == (409, "plan_changed")


def _option(move: str, bars: int, exit_bar: int, entry_bar: int) -> Option:
    exit_cue = (exit_bar, 100.0, "phrase", 0.5, 0)
    return Option(move, bars, exit_cue, (entry_bar, 0.0, "verse", 0.6, 0))


def _failed(fix: str | None, name: str = "level fall") -> AuditFacts:
    return AuditFacts(False, (FailedCheck(name, 9.0, 3.0, fix),))


OPTIONS = [
    _option("bass_swap_blend", 16, 40, 8),
    _option("bass_swap_blend", 8, 40, 8),
    _option("bass_swap_blend", 16, 56, 8),
    _option("echo_out", 0, 40, 8),
    _option("cut_on_one", 0, 40, 8),
]
CASES = [
    [],
    [Attempted(0, AuditFacts(True))],
    [Attempted(0, _failed("shorten"))],
    [Attempted(0, _failed("move_cue"))],
    [Attempted(0, _failed(None))],
    [Attempted(0, None)],
    [Attempted(i, _failed(None)) for i in range(5)],
    [Attempted(0, _failed("shorten")), Attempted(1, AuditFacts(True))],
]


@pytest.mark.parametrize("attempts", CASES)
def test_the_next_step_route_is_the_repair_rule(cloud, attempts):
    answer = cloud["client"].post(
        "/api/planning/next-step",
        headers=_auth(ALICE),
        json={
            "options": [option.to_json() for option in OPTIONS],
            "attempts": [attempt.to_json() for attempt in attempts],
        },
    )
    assert answer.status_code == 200, answer.text
    assert answer.json() == _norm(next_step(OPTIONS, attempts).to_json())


@pytest.mark.parametrize(
    ("first", "second"),
    [
        (AuditFacts(True), None),
        (_failed(None, "beat alignment"), None),
        (_failed(None, "beat alignment"), AuditFacts(True)),
        (AuditFacts(True), _failed(None)),
    ],
)
def test_the_take_step_route_is_the_repair_rule(cloud, first, second):
    answer = cloud["client"].post(
        "/api/planning/take-step",
        headers=_auth(ALICE),
        json={"first": first.to_json(), "second": None if second is None else second.to_json()},
    )
    assert answer.status_code == 200, answer.text
    assert answer.json() == _norm(take_step(first, second).to_json())


def test_song_order_equals_the_desktop_planners_and_names_unmeasured_songs(cloud):
    ids = cloud["ids"]
    answer = cloud["client"].post(
        "/api/planning/order",
        headers=_auth(ALICE),
        json={"songs": [*ids, cloud["unmeasured"]], "count": 6, "seed": 7},
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["not_measured"] == [cloud["unmeasured"]]
    songs = _infos(ids)
    planned, seams = build_vibe(
        resolve_vibe("pick"), songs, traits_of(songs, {}), {}, 6, None, seed=7,
        memory=SeamMemory(), mix_language=None, end_id=None, stems="sometimes", energy_arc=None,
    )
    assert body["order"] == [item.song.id for item in planned]
    assert [step["move"] for step in body["steps"]] == [
        seams.get(item.song.id, {}).get("move") for item in planned[1:]
    ]


def test_too_few_measured_songs_is_a_clear_refusal(cloud):
    answer = cloud["client"].post(
        "/api/planning/order",
        headers=_auth(ALICE),
        json={"songs": [cloud["ids"][0], cloud["unmeasured"]]},
    )
    assert answer.status_code == 409, answer.text
    detail = answer.json()["detail"]
    assert detail["code"] == "too_few_measured"
    assert detail["not_measured"] == [cloud["unmeasured"]]


def test_ideas_come_from_the_measured_songs(cloud):
    answer = cloud["client"].post(
        "/api/planning/ideas", headers=_auth(ALICE), json={"songs": cloud["ids"]}
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["ideas"] and answer.json()["not_measured"] == []


def test_a_second_account_cannot_read_write_or_plan_with_the_firsts_songs(cloud):
    client, ids = cloud["client"], cloud["ids"]
    mine = client.get("/api/song-facts", headers=_auth(ALICE)).json()
    assert sorted(song["song_id"] for song in mine["songs"]) == sorted(ids)
    assert client.get("/api/song-facts", headers=_auth(BOB)).json() == {"songs": []}
    write = client.put(
        f"/api/song-facts/{ids[0]}", headers=_auth(BOB), json=facts_body(1, sha=sha_for(1))
    )
    assert (write.status_code, write.json()["detail"]["code"]) == (404, "song_not_found")
    fix = client.put(f"/api/song-facts/{ids[0]}/correction", headers=_auth(BOB), json={"bpm": 90})
    assert fix.status_code == 404
    pair = {"a": ids[0], "b": ids[1]}
    plan = client.post("/api/planning/candidates", headers=_auth(BOB), json=pair)
    assert (plan.status_code, plan.json()["detail"]["code"]) == (409, "not_measured")
    order = client.post("/api/planning/order", headers=_auth(BOB), json={"songs": ids})
    assert order.status_code == 409
    assert sorted(order.json()["detail"]["not_measured"]) == sorted(ids)


def test_a_facts_upload_is_refused_when_too_large_or_not_json(cloud):
    client, song = cloud["client"], cloud["ids"][0]
    huge = client.put(
        f"/api/song-facts/{song}",
        headers={**_auth(ALICE), "Content-Type": "application/json"},
        content=b"{" + b" " * (4 * 1024 * 1024 + 1) + b"}",
    )
    assert huge.status_code == 413
    audio = client.put(
        f"/api/song-facts/{song}",
        headers={**_auth(ALICE), "Content-Type": "audio/mpeg"},
        content=b"ID3\x04\x00not audio",
    )
    assert (audio.status_code, audio.json()["detail"]["code"]) == (415, "json_only")


def test_every_route_is_refused_with_the_flag_off(cloud):
    flags.use("-cloud.brain")
    for route in flags.registry()["cloud.brain"].routes:
        method, path = route.split(" ", 1)
        answer = cloud["client"].request(
            method, path.replace("{song_id}", str(cloud["ids"][0])), headers=_auth(ALICE), json={}
        )
        assert answer.status_code == 403, route
        assert answer.json()["code"] == "flag_off", route


def test_the_export_carries_the_engine_tables_and_the_arrays(cloud):
    client = cloud["client"]
    client.put(f"/api/song-facts/{cloud['ids'][0]}/correction", headers=_auth(ALICE),
               json={"bpm": 121.0, "camelot": None})
    answer = client.get("/api/account/export", headers=_auth(ALICE))
    assert answer.status_code == 200, answer.text
    with zipfile.ZipFile(io.BytesIO(answer.content)) as archive:
        kept = json.loads(archive.read("song-facts.json"))
        names = set(archive.namelist())
        manifest = json.loads(archive.read("manifest.json"))
    assert sorted(row["song_id"] for row in kept["measurements"]) == sorted(cloud["ids"])
    assert [row["bpm"] for row in kept["corrections"]] == [121.0]
    assert {"ratings", "other_file_hashes"} <= set(kept)
    assert {f"song-facts/features/{song_id}.npz" for song_id in cloud["ids"]} <= names
    assert "song_facts" in manifest


def test_account_deletion_sweeps_the_engine_tables_and_the_features():
    """Deletion removes every row carrying the workspace id (`delete_workspace_rows`) and every
    derived object under the workspace prefix; the engine tables and features keys are in both."""
    from selecta.engine_store.schema import ENGINE_TABLES
    from selecta.engine_store.songs import features_key
    from selecta.identity.deletion_effects import PRESERVED_WORKSPACE_TABLES
    from selecta.persistence.registry import load_all_tables
    from selecta.storage.deletion import Deletion, DeletionKind, physical_targets
    from selecta.storage.keys import Bucket, workspace_prefix

    load_all_tables()
    for name in [table.name for table in ENGINE_TABLES] + ["local_song_hashes"]:
        table = metadata.tables[name]
        assert "workspace_id" in table.c and name not in PRESERVED_WORKSPACE_TABLES
    workspace = new_id()
    targets = physical_targets(
        Deletion(new_id(), workspace, DeletionKind.ACCOUNT, workspace, 0, 1.0, 2.0)
    )
    key = features_key(workspace, "ab" * 32, 1001)
    assert any(key.startswith(prefix) for prefix in targets.prefixes[Bucket.DERIVED])
    assert workspace_prefix(workspace) in targets.prefixes[Bucket.DERIVED]


@pytest.mark.parametrize("language", ["seamless", "punchy"])
def test_a_transition_feel_keeps_its_family_as_the_desktop_build_does(cloud, language):
    from selecta.planner_core.choose import styles_for_language

    first, second = cloud["ids"][:2]
    asked = {"a": first, "b": second, "language": language}
    answer = cloud["client"].post("/api/planning/candidates", headers=_auth(ALICE), json=asked)
    assert answer.status_code == 200, answer.text
    a, b = _infos(cloud["ids"])[:2]
    every = enumerate_candidates(a, b, None, exits=None)
    family = styles_for_language(language) or set()
    kept = [one for one in every if one.recipe.name in family] or every
    body = answer.json()
    assert body["options"] == _norm(
        [_expected_entry(i, c, a, b, i < 8) for i, c in enumerate(kept[:300])]
    )
    script = cloud["client"].post(
        "/api/planning/candidates/script",
        headers=_auth(ALICE),
        json={**asked, "option": 0, "fingerprint": body["fingerprint"]},
    )
    assert script.status_code == 200, script.text
    unknown = cloud["client"].post(
        "/api/planning/candidates", headers=_auth(ALICE), json={**asked, "language": "loud"}
    )
    assert unknown.status_code == 422
