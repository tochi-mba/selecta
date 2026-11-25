"""`/api/catalog/...` in the Cloud app (ADR-0478 FL-0478-03 and -04).

The world is `cloud_admin_kit.make_world`: two customers in their own workspaces, and staff with
admin sessions. Lookups run through the real service over replayed answers
(`catalog_kit.Replay`); covers live in `FakeS3`, which the image route reads.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from catalog_kit import ALBUM, ISRC, SINGLE, add_song, isrc_replay, musicbrainz, tiny_jpeg
from cloud_admin_kit import audit_actions, make_world
from test_cloud_storage_fakes import FakeS3

from selecta import flags
from selecta.catalog import client, service
from selecta.catalog.routes import CACHE_CONTROL, ROUTES
from selecta.catalog.schema import catalog_art, song_catalog_links
from selecta.persistence import transaction

BUCKET = "derived"


@pytest.fixture
def world(cloud_engine, monkeypatch):
    flags.use("+library.art_embedded +library.art_lookup")
    saved = client.process_gate()
    client.use_gate(client.Gate(0.0, sleep=lambda _s: None))
    objects = FakeS3()
    monkeypatch.setattr(service, "_default_objects", lambda: (objects, BUCKET))
    built = make_world(cloud_engine)
    built.objects = objects
    yield built
    built.http.__exit__(None, None, None)
    client.use_gate(saved)


def call(world, method: str, path: str, who: str = "customer", **body):
    headers = world.headers(who)
    return world.http.request(method, path, headers=headers, json=body or None)


def looked_up(world, who: str = "customer") -> tuple[int, str]:
    """A song in `who`'s workspace, asked for and looked up. Returns the song and its art id."""
    ws = world.workspaces[who]
    song = add_song(world.engine, ws)
    turned_on = call(world, "PUT", "/api/catalog/settings", who, lookups=True)
    assert turned_on.status_code == 200, turned_on.text
    asked = call(world, "POST", "/api/catalog/art", who, songs=[{"id": song, "isrc": ISRC}])
    assert asked.status_code == 200, asked.text
    assert asked.json()["queued"] == 1 and asked.json()["songs"][0]["state"] == "pending"
    with transaction(world.engine, ws) as conn:
        key = conn.execute(sa.select(song_catalog_links.c.lookup_key).where(
            song_catalog_links.c.song_id == song)).scalar_one()
    with musicbrainz(isrc_replay()) as mb:
        ran = service.run_lookup(world.engine, key, musicbrainz=mb, objects=world.objects,
                                 bucket=BUCKET)
    assert ran == {"outcome": "matched", "method": "isrc", "cover": True}, ran
    answer = call(world, "POST", "/api/catalog/art", who, songs=[{"id": song, "isrc": ISRC}]).json()
    assert answer["songs"][0]["state"] == "matched", answer
    return song, answer["songs"][0]["art"]["id"]


def test_every_catalogue_route_is_mounted_and_owned():
    owners = flags.route_owners()
    assert {owners[route] for route in ROUTES} == {"library.art_lookup", "admin.console"}


def test_every_route_is_refused_while_the_flag_is_off(world):
    flags.use(None)
    for method, path in [
        ("POST", "/api/catalog/art"),
        ("GET", "/api/catalog/art/abc/500"),
        ("GET", "/api/catalog/songs/1/candidates"),
        ("PUT", "/api/catalog/songs/1/choice"),
        ("GET", "/api/catalog/settings"),
        ("PUT", "/api/catalog/settings"),
    ]:
        answer = call(world, method, path, lookups=True)
        assert answer.status_code == 403, (method, path, answer.text)
        assert answer.json()["code"] == "flag_off"
        assert answer.json()["flag"] == "library.art_lookup"


def test_the_setting_is_off_until_the_person_turns_it_on_and_is_theirs_alone(world):
    assert call(world, "GET", "/api/catalog/settings").json() == {"lookups": False}
    assert call(world, "PUT", "/api/catalog/settings", lookups=True).json() == {"lookups": True}
    assert call(world, "GET", "/api/catalog/settings").json() == {"lookups": True}
    assert call(world, "GET", "/api/catalog/settings", "customer2").json() == {"lookups": False}
    assert call(world, "PUT", "/api/catalog/settings", lookups="yes please").status_code == 422
    song = add_song(world.engine, world.workspaces["customer2"])
    asked = call(world, "POST", "/api/catalog/art", "customer2", songs=[{"id": song}]).json()
    assert asked["queued"] == 0 and asked["lookups_allowed"] is False
    assert asked["songs"][0]["state"] == "none"


def test_the_image_route_serves_our_bytes_with_a_private_cache(world):
    _, art_id = looked_up(world)

    answer = world.http.get(f"/api/catalog/art/{art_id}/500")
    assert answer.status_code == 200
    assert answer.content == tiny_jpeg()
    assert answer.headers["content-type"] == "image/jpeg"
    assert answer.headers["cache-control"] == CACHE_CONTROL
    # a hidden image must leave browser caches soon: no week-long or immutable caching
    assert "immutable" not in CACHE_CONTROL
    assert int(CACHE_CONTROL.split("max-age=")[1].split(",")[0]) <= 3600
    assert answer.headers["x-content-type-options"] == "nosniff"


def test_the_image_route_answers_404_for_unknown_hidden_or_unstored_sizes(world):
    _, art_id = looked_up(world)

    assert world.http.get("/api/catalog/art/no-such-image/500").status_code == 404
    assert world.http.get(f"/api/catalog/art/{art_id}/1200").status_code == 404
    assert world.http.get(f"/api/catalog/art/{art_id}/333").status_code == 422
    with transaction(world.engine) as conn:
        conn.execute(catalog_art.update().where(catalog_art.c.id == art_id).values(hidden=True))
    assert world.http.get(f"/api/catalog/art/{art_id}/500").status_code == 404


def test_another_workspace_cannot_read_a_songs_link(world):
    song, _ = looked_up(world)

    other = call(world, "POST", "/api/catalog/art", "customer2", songs=[{"id": song}]).json()
    assert other["songs"] == [{"song_id": song, "state": "none", "art": None,
                               "confidence": None, "method": None, "details": None}]
    assert call(world, "GET", f"/api/catalog/songs/{song}/candidates",
                "customer2").status_code == 404
    choice = call(world, "PUT", f"/api/catalog/songs/{song}/choice", "customer2",
                  choice="generated")
    assert choice.status_code == 404
    mine = call(world, "POST", "/api/catalog/art", songs=[{"id": song, "isrc": ISRC}]).json()
    assert mine["songs"][0]["state"] == "matched", "the other workspace changed nothing"


def test_wrong_cover_candidates_and_choice_round_trip(world):
    song, _ = looked_up(world)

    offered = call(world, "GET", f"/api/catalog/songs/{song}/candidates")
    assert offered.status_code == 200, offered.text
    body = offered.json()
    assert body["choice"] == "auto" and body["outcome"] == "matched"
    assert [r["release_id"] for r in body["releases"] if r["current"]] == [ALBUM]

    picked = call(world, "PUT", f"/api/catalog/songs/{song}/choice", choice="release",
                  release_id=SINGLE)
    assert picked.status_code == 200, picked.text
    assert picked.json()["cover_pending"] is True
    assert picked.json()["song"]["details"]["release_id"] == SINGLE
    again = call(world, "GET", f"/api/catalog/songs/{song}/candidates").json()
    assert again["choice"] == "release"
    assert [r["release_id"] for r in again["releases"] if r["current"]] == [SINGLE]

    tile = call(world, "PUT", f"/api/catalog/songs/{song}/choice", choice="generated")
    assert tile.json()["song"]["state"] == "generated"
    assert not [r for r in call(world, "GET", f"/api/catalog/songs/{song}/candidates")
                .json()["releases"] if r["current"]]
    back = call(world, "PUT", f"/api/catalog/songs/{song}/choice", choice="auto")
    assert back.json()["song"]["details"]["release_id"] == ALBUM

    wrong = call(world, "PUT", f"/api/catalog/songs/{song}/choice", choice="release",
                 release_id="ffffffff-0000-4000-8000-000000000000")
    assert wrong.status_code == 400 and wrong.json()["detail"]["code"] == "invalid_choice"
    assert call(world, "PUT", f"/api/catalog/songs/{song}/choice",
                choice="anything").status_code == 422
    assert call(world, "GET", "/api/catalog/songs/424242/candidates").status_code == 404


def changes(world) -> list[dict]:
    """The audit rows of hides and unhides (the permission checks have their own rows)."""
    return [r for r in audit_actions(world.engine, resource_type="catalog_art")
            if r["action"].startswith("legal.catalog_art.")]


def test_staff_hide_and_unhide_an_image_with_an_audit_row(world):
    song, art_id = looked_up(world)
    path = f"/api/admin/catalog/art/{art_id}"

    hidden = call(world, "POST", f"{path}/hide", "owner", reason="rights holder asked")
    assert hidden.status_code == 200, hidden.text
    assert hidden.json() == {"id": art_id, "hidden": True}
    assert world.http.get(f"/api/catalog/art/{art_id}/500").status_code == 404
    seen = call(world, "POST", "/api/catalog/art", songs=[{"id": song, "isrc": ISRC}]).json()
    assert seen["songs"][0]["art"] is None

    shown = call(world, "POST", f"{path}/unhide", "owner", reason="notice withdrawn")
    assert shown.status_code == 200, shown.text
    assert world.http.get(f"/api/catalog/art/{art_id}/500").status_code == 200

    rows = changes(world)
    assert [r["action"] for r in rows] == ["legal.catalog_art.hidden",
                                           "legal.catalog_art.unhidden"]
    assert rows[0]["resource_id"] == art_id and rows[0]["actor_id"] == world.users["owner"]
    assert rows[0]["metadata"]["release_id"] == ALBUM
    assert rows[0]["reason"] == "rights holder asked"
    allowed = [r for r in audit_actions(world.engine, resource_type="catalog_art")
               if r["action"] == "legal.takedowns.manage"]
    assert [r["result"] for r in allowed] == ["allow", "allow"], "each check is audited too"


def test_hiding_needs_the_takedown_permission_and_a_known_image(world):
    _, art_id = looked_up(world)
    path = f"/api/admin/catalog/art/{art_id}/hide"

    assert call(world, "POST", path, "auditor", reason="x").status_code == 403
    assert call(world, "POST", path, "customer", reason="x").status_code in (401, 403)
    assert call(world, "POST", path, "owner", reason="").status_code == 422
    assert call(world, "POST", f"/api/admin/catalog/art/{art_id}/delete", "owner",
                reason="x").status_code == 404
    unknown = call(world, "POST", "/api/admin/catalog/art/nope/hide", "owner", reason="x")
    assert unknown.status_code == 404
    with transaction(world.engine) as conn:
        assert conn.execute(sa.select(catalog_art.c.hidden)).scalar_one() is False
    assert not changes(world), "nothing was hidden, so no change is recorded"
    denied = [r for r in audit_actions(world.engine, resource_type="catalog_art")
              if r["actor_id"] == world.users["auditor"]]
    assert [(r["action"], r["result"]) for r in denied] == [("legal.takedowns.manage", "deny")]


def found(world, q: str = "", who: str = "owner"):
    return world.http.get("/api/admin/catalog/art", params={"q": q}, headers=world.headers(who))


def test_staff_find_an_image_by_song_release_artist_or_id_and_see_it_hidden(world):
    _, art_id = looked_up(world)

    for words in ["lanterns over", "LOW TIDE", "night harbour", art_id, ALBUM, ""]:
        answer = found(world, words)
        assert answer.status_code == 200, (words, answer.text)
        assert [row["id"] for row in answer.json()["art"]] == [art_id], words
    row = found(world, "low tide").json()["art"][0]
    assert row["release_id"] == ALBUM and row["title"] == "Low Tide"
    assert row["hidden"] is False and row["preview"] == f"/api/catalog/art/{art_id}/500"
    # LIKE wildcards in the words are literal, so "%" finds nothing rather than everything
    assert found(world, "%").json()["art"] == []
    assert found(world, "no such song anywhere").json()["art"] == []

    hidden = call(world, "POST", f"/api/admin/catalog/art/{art_id}/hide", "owner",
                  reason="rights holder asked")
    assert hidden.status_code == 200, hidden.text
    row = found(world, art_id).json()["art"][0]
    assert row["hidden"] is True and row["hidden_reason"] == "rights holder asked"
    assert row["hidden_by"] == world.users["owner"] and row["preview"] is None


def test_finding_images_needs_the_takedown_permission(world):
    looked_up(world)

    assert found(world, who="auditor").status_code == 403
    assert found(world, who="customer").status_code in (401, 403)
    assert found(world, "x" * 201).status_code == 422
