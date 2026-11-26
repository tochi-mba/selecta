"""One song, however many files of it (ADR-0469 amendment 2).

A different file with the same normalised title and artist and a length within a few seconds is
a version of a song: grouped under the earliest row, never merged, never listed on its own. A
remix (same name, clearly different length) stays its own song. Existing groups are repaired
once per workspace per rule, never by a viewer's read. Rooms and Lucy see one row per song.

The guard at the end keeps it that way: a module that reads `local_songs` must be one that is
known to read it by id or by hash, or go through `versions.listed_songs`.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from cloud_party import ALICE, auth

from selecta import flags
from selecta.local_media import store, versions
from selecta.local_media.catalog import LocalMediaCatalog
from selecta.local_media.schema import local_songs
from selecta.local_media.versions_schema import local_song_versions_state
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)

ROOT = Path(__file__).resolve().parents[1]


def sha(n: int) -> str:
    return f"{n:064x}"


def song(
    n: int, title: str = "Agora Hills", artist: str = "Doja Cat", seconds: float | None = 265.0
) -> dict:
    made = {"content_sha256": sha(n), "title": title, "artist": artist}
    if seconds is not None:
        made["duration_s"] = seconds
    return made


@pytest.fixture
def local_media_on():
    flags.use("+cloud.local_media")
    yield
    flags.use(None)


def _register(party, songs: list[dict]) -> list[dict]:
    answer = party.client.post("/api/local-media/songs", headers=auth(ALICE), json={"songs": songs})
    assert answer.status_code == 200, answer.text
    return answer.json()["songs"]


# -- the rule ------------------------------------------------------------------------------------


def test_lengths_within_three_seconds_are_the_same_recording():
    assert versions.same_length(265.0, 267.9)
    assert not versions.same_length(265.0, 340.0)
    # an unknown length cannot tell them apart, so the name decides
    assert versions.same_length(None, 340.0)


def test_identical_bytes_are_one_song_whatever_the_name(party, local_media_on):
    first, again = _register(party, [song(1), song(1, title="Agora Hills (copy)")])
    assert first["song_id"] == again["song_id"]
    assert "duplicate_of" not in again


def test_another_file_of_the_song_is_a_version_and_a_remix_is_its_own_song(party, local_media_on):
    first, copy, remix = _register(
        party, [song(1), song(2, title=" agora  HILLS ", seconds=266.5), song(3, seconds=340.0)]
    )
    assert copy["duplicate_of"] == first["song_id"]
    assert "duplicate_of" not in remix
    with transaction(party.engine) as conn:
        listed = [
            row.id
            for row in conn.execute(
                versions.listed_songs(party.workspaces[ALICE], local_songs.c.id)
            )
        ]
        groups = versions.groups_of(conn, party.workspaces[ALICE], [copy["song_id"]])
        primary = versions.primary_of(conn, party.workspaces[ALICE], copy["song_id"])
    assert sorted(listed) == sorted([first["song_id"], remix["song_id"]])
    assert groups == {copy["song_id"]: [first["song_id"], copy["song_id"]]}
    assert primary == first["song_id"]


# -- the repair ----------------------------------------------------------------------------------


def test_regrouping_splits_a_remix_marked_a_copy_and_changes_nothing_the_second_time(
    party, local_media_on
):
    workspace = party.workspaces[ALICE]
    first, remix = _register(party, [song(1), song(3, seconds=340.0)])
    with transaction(party.engine, workspace) as conn:
        # grouped by name alone, as registrations were before lengths counted
        conn.execute(
            local_songs.update()
            .where(local_songs.c.id == remix["song_id"])
            .values(duplicate_of=first["song_id"])
        )
        made = versions.regroup_versions(conn, workspace)
        again = versions.regroup_versions(conn, workspace)
    assert made["now_songs"] == 1
    assert again == {"checked": 2, "now_versions": 0, "now_songs": 0, "moved": 0}


def test_removing_the_primary_promotes_its_version(party, local_media_on):
    first, copy = _register(party, [song(1), song(2, seconds=266.0)])
    removed = party.client.delete(f"/api/local-media/songs/{first['song_id']}", headers=auth(ALICE))
    assert removed.status_code == 200
    detail = party.client.get(
        f"/api/local-media/songs/{copy['song_id']}", headers=auth(ALICE)
    ).json()["song"]
    assert detail["duplicate_of"] is None


def test_existing_groups_are_repaired_once_per_rule_on_the_first_read(party, local_media_on):
    workspace = party.workspaces[ALICE]
    first, remix = _register(party, [song(1), song(3, seconds=340.0)])
    with transaction(party.engine, workspace) as conn:
        conn.execute(
            local_songs.update()
            .where(local_songs.c.id == remix["song_id"])
            .values(duplicate_of=first["song_id"])
        )
        conn.execute(
            local_song_versions_state.delete().where(
                local_song_versions_state.c.workspace_id == workspace
            )
        )
    listed = party.client.get("/api/local-media/songs", headers=auth(ALICE)).json()["songs"]
    assert {row["id"]: row["duplicate_of"] for row in listed}[remix["song_id"]] is None
    with transaction(party.engine, workspace) as conn:
        state = conn.execute(local_song_versions_state.select()).first()
        assert state.rule_version == versions.RULE_VERSION
        # once done, a read leaves the links alone until the rule changes
        conn.execute(
            local_songs.update()
            .where(local_songs.c.id == remix["song_id"])
            .values(duplicate_of=first["song_id"])
        )
    party.client.get("/api/local-media/songs", headers=auth(ALICE))
    with transaction(party.engine, workspace) as conn:
        assert versions.ensure_regrouped(conn, workspace) is None
        assert store.get_song(conn, workspace, remix["song_id"])["duplicate_of"] == first["song_id"]


# -- what people see -----------------------------------------------------------------------------


def test_a_room_offers_one_row_per_song_held_through_any_version(party, local_media_on):
    workspace = party.workspaces[ALICE]
    first, copy, remix = _register(party, [song(1), song(2, seconds=266.0), song(3, seconds=340.0)])
    device = party.client.post(
        "/api/devices", headers=auth(ALICE), json={"name": "Browser", "kind": "laptop"}
    ).json()["device"]["id"]
    # the device holds only the extra copy of the song, and the remix
    reported = party.client.post(
        "/api/local-media/availability",
        headers=auth(ALICE),
        json={"device_id": device, "present": [copy["song_id"], remix["song_id"]], "absent": []},
    )
    assert reported.status_code == 200
    catalog = LocalMediaCatalog(party.engine)
    found = catalog.search(workspace, "agora", None, 10)
    assert sorted((entry.song_id, entry.length_s) for entry in found) == sorted(
        [(first["song_id"], 265.0), (remix["song_id"], 340.0)]
    )
    assert catalog.count_requestable(workspace, None) == 2
    # an id from an older list is read as its song
    assert catalog.is_requestable(workspace, copy["song_id"]) is True


# -- the guard -----------------------------------------------------------------------------------

# Modules that may name `local_songs`, and why. A new one either reads by id or by content hash
# (add it here, saying so) or lists songs, which it must do through `versions.listed_songs`.
READS_BY_ID_OR_HASH = {
    "src/selecta/local_media/schema.py": "declares the table",
    "src/selecta/local_media/lyrics_schema.py": "foreign key",
    "src/selecta/local_media/hashes_schema.py": "foreign key from a song's other file hashes",
    "src/selecta/local_media/__init__.py": "re-exports the schema",
    "src/selecta/local_media/store.py": "registration, by-id reads, the file list",
    "src/selecta/local_media/versions.py": "the grouping itself and listed_songs",
    "src/selecta/local_media/catalog.py": "rooms: primaries through its own grouped query",
    "src/selecta/local_media/links.py": "word links by id",
    "src/selecta/lucy/cloud_tools.py": "lists through listed_songs",
    "src/selecta/lucy/cloud_routes.py": "lists through listed_songs",
    "src/selecta/lucy/cloud_world.py": "a room request's song, by id",
    "src/selecta/playback/programme.py": "a programme's songs and their versions, by id",
    "src/selecta/routes/cloud_export.py": "the account's own data export: every file, on purpose",
    "src/selecta/storage/catalogue_link.py": "by content hash",
    "src/selecta/storage/schema.py": "mentions the table in a comment",
    "src/selecta/storage/shared_derivations.py": "by content hash",
    "src/selecta/usage/meters.py": "counts through listed_songs",
    "src/selecta/admin/read_models.py": "staff count; see the admin to-do on counting songs",
    "src/selecta/devstack/lucy_practice.py": "local practice data",
    "src/selecta/business/content/library.py": "by content hash",
    "src/selecta/business/health.py": "by id",
    "src/selecta/business/kiosk_rooms.py": "by id",
    "src/selecta/business/permits.py": "by id",
    "src/selecta/business/playlog_writer.py": "by id",
    "src/selecta/business/rooms/ports.py": "by id",
    "src/selecta/business/upload_rights.py": "by id",
    "src/selecta/business/workspace_routes.py": "by content hash",
    "src/selecta/engine_store/schema.py": "foreign key from a song's facts",
    "src/selecta/engine_store/songs.py": "one song's facts, by id",
    "src/selecta/engine_store/song_hashes.py": "mentions the table in a comment",
    "src/selecta/engine_store/facts_store.py": "a song's facts, by id or by content hash",
    "src/selecta/cloud_brain/export.py": "the account's own export: every measured song's hash",
    "src/selecta/cloud_brain/planning_routes.py": "never-play for the songs a plan names, by id",
}


def test_nothing_new_reads_local_songs_without_going_through_listed_songs():
    naming = re.compile(r"\blocal_songs\b")
    found = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "src" / "selecta").rglob("*.py")
        if "migrations" not in path.parts and naming.search(path.read_text(encoding="utf-8"))
    }
    unexplained = sorted(found - set(READS_BY_ID_OR_HASH))
    assert not unexplained, (
        "These modules read local_songs. A listing, search or count must use "
        "versions.listed_songs (one row per song); a read by id or hash goes in the list: "
        f"{unexplained}"
    )
