"""The upload rights statement (`storage.personal_rights`, ADR-0489, plan "two places" 6c).

`GET /api/uploads/rights` and `POST /api/uploads/rights`, behind `cloud.move_to_cloud`: a
workspace that is not a business confirms the statement once per wording, kept with its version,
the hash of its words, who and when. A new wording asks again; a business workspace is never
asked; the account export carries the record and account deletion sweeps it; one workspace's
record is never another's; an account without the cloud library grant is refused. An upload
plan waits for the statement (409 `rights_needed`) and goes ahead once it is agreed; the dry run
does not wait, a business plans without it, and with the flag off plans are as before.

`cloud_engine` runs each test on migrated SQLite, and on PostgreSQL where
`SELECTA_TEST_POSTGRES_URL` is set.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

import pytest
import sqlalchemy as sa
from cloud_helpers import grant_hosted_media
from cloud_party import ALICE, BOB, CAROL, auth
from test_cloud_storage_fakes import FakeS3

from selecta import flags
from selecta.flags.matching import Rule, RuleKind
from selecta.identity.schema import workspace_members, workspaces
from selecta.persistence import db_now, metadata, new_id, transaction
from selecta.storage import api as storage_api
from selecta.storage import personal_rights
from selecta.storage.rights_schema import upload_rights

pytest_plugins = ("cloud_party",)

PATH = "/api/uploads/rights"


@pytest.fixture
def rights(party):
    """The party with the cloud library granted to everyone and the flag's needs on."""
    flags.use("+storage.upload_identity")
    grant_hosted_media(party.engine, party.app)
    return party


def _current() -> dict[str, str]:
    return {"version": personal_rights.STATEMENT_VERSION,
            "wording_sha256": personal_rights.WORDING_SHA256}


def _user_id(party, token: str) -> str:
    return party.client.get("/api/account", headers=auth(token)).json()["user"]["id"]


def _code(answer) -> str:
    """A refusal's code: the account gate puts it in `detail`, the build guard at the top."""
    body = answer.json()
    return body["detail"]["code"] if isinstance(body.get("detail"), dict) else body["code"]


def _rows(party, workspace_id: str) -> list[dict]:
    with transaction(party.engine, workspace_id) as conn:
        return [dict(row) for row in conn.execute(
            sa.select(upload_rights).where(upload_rights.c.workspace_id == workspace_id)
        ).mappings()]


def test_a_workspace_confirms_the_statement_once_and_it_is_kept(rights):
    before = rights.client.get(PATH, headers=auth(ALICE))
    assert before.status_code == 200, before.text
    asked = before.json()
    assert asked["applies"] is True and asked["accepted"] is False
    assert asked["statement"] == personal_rights.STATEMENT
    assert asked["version"] == personal_rights.STATEMENT_VERSION
    assert asked["wording_sha256"] == hashlib.sha256(asked["statement"].encode()).hexdigest()

    first = rights.client.post(PATH, headers=auth(ALICE), json=_current())
    assert first.status_code == 200, first.text
    assert first.json()["accepted"] is True and first.json()["recorded"] is True
    again = rights.client.post(PATH, headers=auth(ALICE), json=_current())
    assert again.json()["recorded"] is False

    after = rights.client.get(PATH, headers=auth(ALICE)).json()
    assert after["accepted"] is True and after["accepted_at"] is not None
    workspace = rights.workspaces[ALICE]
    (row,) = _rows(rights, workspace)
    assert row["version"] == personal_rights.STATEMENT_VERSION
    assert row["wording_sha256"] == personal_rights.WORDING_SHA256
    assert row["user_id"] == _user_id(rights, ALICE)
    assert row["accepted_at"] == after["accepted_at"]


def test_a_page_showing_other_words_is_refused_and_told_the_current_ones(rights):
    stale = rights.client.post(PATH, headers=auth(ALICE),
                               json={"version": "2020-01-01", "wording_sha256": "0" * 64})
    assert stale.status_code == 409, stale.text
    detail = stale.json()["detail"]
    assert detail["code"] == "stale_statement"
    assert detail["statement"] == personal_rights.STATEMENT
    assert _rows(rights, rights.workspaces[ALICE]) == []


def test_new_wording_asks_every_workspace_again_and_keeps_the_old_record(rights, monkeypatch):
    assert rights.client.post(PATH, headers=auth(ALICE), json=_current()).status_code == 200
    words = "I own these files. I understand SelectaDJ keeps them privately for my account."
    monkeypatch.setattr(personal_rights, "STATEMENT", words)
    monkeypatch.setattr(personal_rights, "STATEMENT_VERSION", "2027-01-01")
    monkeypatch.setattr(personal_rights, "WORDING_SHA256",
                        hashlib.sha256(words.encode()).hexdigest())

    asked = rights.client.get(PATH, headers=auth(ALICE)).json()
    assert asked["accepted"] is False and asked["version"] == "2027-01-01"
    assert asked["statement"] == words
    old = {"version": "2026-11-26", "wording_sha256": hashlib.sha256(
        b"I own these files or have the right to store copies of them for my own use. "
        b"I understand SelectaDJ keeps them privately for my account.").hexdigest()}
    assert rights.client.post(PATH, headers=auth(ALICE), json=old).status_code == 409
    assert rights.client.post(PATH, headers=auth(ALICE), json=_current()).status_code == 200
    assert rights.client.get(PATH, headers=auth(ALICE)).json()["accepted"] is True
    assert {row["version"] for row in _rows(rights, rights.workspaces[ALICE])} == {
        "2026-11-26", "2027-01-01"}


def _business_workspace(party, token: str) -> str:
    """A business workspace the person owns, beside their personal one."""
    user_id = _user_id(party, token)
    workspace_id = new_id()
    with transaction(party.engine) as conn:
        now = db_now(conn)
        conn.execute(workspaces.insert().values(id=workspace_id, name="The Bar", kind="business",
                                                owner_user_id=user_id, created_at=now))
        conn.execute(workspace_members.insert().values(workspace_id=workspace_id, user_id=user_id,
                                                       role="owner", created_at=now))
    return workspace_id


def test_a_business_workspace_keeps_its_own_statement_and_is_never_asked_this_one(rights):
    business = _business_workspace(rights, ALICE)
    asked = rights.client.get(PATH, headers=auth(ALICE, business))
    assert asked.status_code == 200, asked.text
    assert asked.json()["applies"] is False
    assert asked.json()["statement"] is None and asked.json()["reason"] == "business_statement"
    refused = rights.client.post(PATH, headers=auth(ALICE, business), json=_current())
    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"]["code"] == "business_statement"
    assert _rows(rights, business) == []
    assert personal_rights.applies("personal") and personal_rights.applies("team")


def test_one_workspace_confirming_says_nothing_about_another(rights):
    assert rights.client.post(PATH, headers=auth(ALICE), json=_current()).status_code == 200
    assert rights.client.get(PATH, headers=auth(BOB)).json()["accepted"] is False
    # naming Alice's workspace is refused before anything is read or kept
    named = rights.client.get(PATH, headers=auth(BOB, rights.workspaces[ALICE]))
    assert named.status_code == 404, named.text
    kept = rights.client.post(PATH, headers=auth(BOB, rights.workspaces[ALICE]), json=_current())
    assert kept.status_code == 404, kept.text
    assert _rows(rights, rights.workspaces[BOB]) == []
    assert len(_rows(rights, rights.workspaces[ALICE])) == 1


def test_an_account_without_the_cloud_library_grant_is_refused(party):
    flags.use("+storage.upload_identity")
    carol = _user_id(party, CAROL)
    grant_hosted_media(party.engine, party.app, Rule(RuleKind.USERS, {"ids": [carol], "on": False}))
    for answer in (party.client.get(PATH, headers=auth(CAROL)),
                   party.client.post(PATH, headers=auth(CAROL), json=_current())):
        assert answer.status_code == 403, answer.text
        assert _code(answer) == "flag_off"
    assert party.client.get(PATH, headers=auth(ALICE)).status_code == 200
    assert _rows(party, party.workspaces[CAROL]) == []


def test_with_the_flag_off_the_routes_are_refused(rights):
    flags.use("+storage.upload_identity -cloud.move_to_cloud")
    rights.app.state.flag_rules.invalidate()
    for answer in (rights.client.get(PATH, headers=auth(ALICE)),
                   rights.client.post(PATH, headers=auth(ALICE), json=_current())):
        assert answer.status_code == 403, answer.text
        assert _code(answer) == "flag_off"
    assert _rows(rights, rights.workspaces[ALICE]) == []


PLAN = "/api/uploads/plan"
FILES = {"files": [{"name": "song.flac", "size": 10, "sha256": "b" * 64}]}


@pytest.fixture
def objects(monkeypatch):
    """A fake object store behind the upload routes, as the tenant matrix uses."""
    found = FakeS3()
    for name in ("ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        monkeypatch.setenv(f"SELECTA_R2_{name}", "test")
    monkeypatch.setattr(storage_api, "R2Client", lambda *_args, **_kwargs: found)
    return found


def test_a_first_upload_plan_waits_for_the_statement_and_goes_ahead_once_agreed(rights, objects):
    refused = rights.client.post(PLAN, headers=auth(ALICE), json=FILES)
    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == "rights_needed"
    assert detail["statement"] == personal_rights.STATEMENT
    assert detail["version"] == personal_rights.STATEMENT_VERSION
    assert detail["wording_sha256"] == personal_rights.WORDING_SHA256
    assert objects.count("create_multipart_upload") == 0
    # the dry run stays open before it: it sends no audio, and the sheet shows it with the words
    assert rights.client.post("/api/uploads/preview", headers=auth(ALICE), json=FILES
                              ).status_code == 200
    assert rights.client.post(PATH, headers=auth(ALICE), json=_current()).status_code == 200
    planned = rights.client.post(PLAN, headers=auth(ALICE), json=FILES)
    assert planned.status_code == 201, planned.text
    assert planned.json()["uploads"][0]["session"] is not None


def test_a_business_workspace_plans_without_this_statement(rights, objects):
    business = _business_workspace(rights, ALICE)
    planned = rights.client.post(PLAN, headers=auth(ALICE, business), json=FILES)
    # whatever else a business plan meets (its own statement, its storage), never this one
    assert planned.status_code != 409 and "rights_needed" not in planned.text, planned.text
    with transaction(rights.engine, business) as conn:
        assert personal_rights.needed(conn, business) is False


def test_with_the_flag_off_a_plan_is_as_before(rights, objects):
    flags.use("+storage.upload_identity -cloud.move_to_cloud")
    rights.app.state.flag_rules.invalidate()
    planned = rights.client.post(PLAN, headers=auth(ALICE), json=FILES)
    assert planned.status_code == 201, planned.text


def test_the_account_export_carries_the_record(rights):
    assert rights.client.post(PATH, headers=auth(ALICE), json=_current()).status_code == 200
    exported = rights.client.get("/api/account/export", headers=auth(ALICE))
    assert exported.status_code == 200, exported.text
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        settings = json.loads(archive.read("settings.json"))
    (kept,) = settings["upload_rights"]
    assert kept["version"] == personal_rights.STATEMENT_VERSION
    assert kept["wording_sha256"] == personal_rights.WORDING_SHA256
    assert kept["statement"] == personal_rights.STATEMENT
    assert kept["user_id"] == _user_id(rights, ALICE)
    # Bob's export holds none of Alice's
    bob = rights.client.get("/api/account/export", headers=auth(BOB))
    with zipfile.ZipFile(io.BytesIO(bob.content)) as archive:
        assert json.loads(archive.read("settings.json"))["upload_rights"] == []


def test_account_deletion_sweeps_the_record():
    """Deletion removes every row carrying the workspace id (`delete_workspace_rows`), and user
    erasure checks no `user_id` is left behind; this table is in both sweeps."""
    from selecta.identity.deletion_effects import (
        PRESERVED_USER_LINKS,
        PRESERVED_WORKSPACE_TABLES,
        USER_REFERENCE_COLUMNS,
    )
    from selecta.persistence.registry import load_all_tables

    load_all_tables()
    table = metadata.tables["upload_rights"]
    assert "workspace_id" in table.c and table.name not in PRESERVED_WORKSPACE_TABLES
    assert "user_id" in table.c and "user_id" in USER_REFERENCE_COLUMNS
    assert table.name not in PRESERVED_USER_LINKS
