"""The cloud's adapters for the job store: plans, flags and R2 outputs (§4A.4, §4A.6, SC-0396).

Plans and flags are read from the real tables at dispatch time; storage is a fake R2 client with
the same methods, so nothing leaves the process.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from selecta.flags.rules import RulesCache
from selecta.identity.schema import users, workspaces
from selecta.persistence import transaction
from selecta.storage import api as storage_api
from selecta.storage.artifacts import Buckets
from selecta.storage.objects import R2Error
from selecta.storage.r2 import file_sha256
from selecta.work import cloud_ports
from selecta.work.ports import ArtifactOutput

HASH = "a" * 64


def account(engine, workspace_id: str = "ws1", user_id: str = "u1", deleted: bool = False):
    with transaction(engine) as connection:
        connection.execute(users.insert().values(
            id=user_id, auth_subject=f"auth|{user_id}", email_verified=True, timezone="UTC",
            age_confirmed=True, created_at=0.0, deleted_at=5.0 if deleted else None,
        ))
        connection.execute(workspaces.insert().values(
            id=workspace_id, name="Mine", kind="personal", owner_user_id=user_id, created_at=0.0,
        ))


# --- Plans and flags at dispatch ----------------------------------------------------------------


def test_a_workspace_without_a_subscription_runs_on_free_caps(cloud_engine):
    account(cloud_engine)
    standing = cloud_ports.CloudJobEntitlements(cloud_engine).standing("ws1")
    assert (standing.tier, standing.suspended) == ("free", False)
    assert standing.caps == {"interactive": 1, "standard": 1, "speculative": 1}


def test_a_deleted_owner_suspends_the_workspace_and_an_unknown_one_is_suspended(cloud_engine):
    account(cloud_engine, deleted=True)
    plans = cloud_ports.CloudJobEntitlements(cloud_engine)
    assert plans.standing("ws1").suspended is True
    assert plans.standing("nobody").suspended is True


def test_flags_follow_the_owner_and_the_plan(cloud_engine):
    account(cloud_engine)
    account(cloud_engine, "gone", "u2", deleted=True)
    flags = cloud_ports.CloudJobFlags(cloud_engine, RulesCache(cloud_engine))
    assert flags.is_on("ws1", "core.analysis") is True
    assert flags.is_on("gone", "core.analysis") is False
    assert flags.is_on("nobody", "core.analysis") is False


# --- Outputs in R2 ------------------------------------------------------------------------------


class FakeR2:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = objects
        self.closed = False
        self.signed: list[tuple[str, str, int]] = []

    def head_object(self, bucket: str, key: str):
        if key not in self.objects:
            raise R2Error("missing", status=404)
        return SimpleNamespace(size=len(self.objects[key]))

    def get_object(self, bucket: str, key: str, dest: Path):
        dest.write_bytes(self.objects[key])

    def presign_get(self, bucket: str, key: str, ttl: int) -> str:
        self.signed.append((bucket, key, ttl))
        return f"https://r2.test/{bucket}/{key}?signature=x"

    def presign_put(self, bucket: str, key: str, ttl: int) -> str:
        self.signed.append((bucket, key, ttl))
        return f"https://r2.test/{bucket}/{key}?upload=x"

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def r2(monkeypatch):
    client = FakeR2({})
    monkeypatch.setattr(storage_api, "_r2_client", lambda: client)
    monkeypatch.setattr(storage_api, "_buckets", lambda: Buckets())
    return client


def key(workspace: str = "ws1", attempt: str = "att1", name: str = "f.npz") -> str:
    return f"w/{workspace}/analysis/{HASH}/attempts/{attempt}/{name}"


def made(tmp_path, body: bytes, keys, **values) -> ArtifactOutput:
    path = tmp_path / "body"
    path.write_bytes(body)
    size, digest = file_sha256(path)
    values.setdefault("size_bytes", size)
    values.setdefault("checksum", digest)
    return ArtifactOutput("analysis", HASH, keys, **values)


def test_an_output_is_accepted_only_when_every_object_matches_its_size_and_checksum(r2, tmp_path):
    r2.objects[key()] = b"features"
    verifier = cloud_ports.R2OutputVerifier()
    assert verifier.verify("ws1", made(tmp_path, b"features", key())) is True
    assert verifier.verify("ws1", made(tmp_path, b"features", [key()])) is True
    assert r2.closed is True


@pytest.mark.parametrize(
    "problem",
    ["no-keys", "no-size", "no-checksum", "other-workspace", "other-bucket", "outside-prefix",
     "unsafe", "missing", "wrong-size", "wrong-checksum", "changed-after-head"],
)
def test_an_output_that_does_not_match_is_refused(r2, tmp_path, problem):
    body = b"features"
    r2.objects[key()] = body
    r2.objects[key("ws2")] = body
    r2.objects["w/ws1/a/asset1"] = body
    r2.objects[f"w/ws1/analysis/{'b' * 64}/attempts/att1/f.npz"] = body
    output = {
        "no-keys": lambda: made(tmp_path, body, []),
        "no-size": lambda: made(tmp_path, body, key(), size_bytes=None),
        "no-checksum": lambda: made(tmp_path, body, key(), checksum=""),
        "other-workspace": lambda: made(tmp_path, body, key("ws2")),
        "other-bucket": lambda: made(tmp_path, body, "w/ws1/a/asset1"),
        "outside-prefix": lambda: made(tmp_path, body,
                                       f"w/ws1/analysis/{'b' * 64}/attempts/att1/f.npz"),
        "unsafe": lambda: made(tmp_path, body, "../etc/passwd"),
        "missing": lambda: made(tmp_path, body, key(name="gone.npz")),
        "wrong-size": lambda: made(tmp_path, body, key(), size_bytes=99),
        "wrong-checksum": lambda: made(tmp_path, body, key(), checksum="0" * 64),
        "changed-after-head": lambda: made(tmp_path, body, key()),
    }[problem]()
    if problem == "changed-after-head":
        original = r2.get_object
        r2.get_object = lambda bucket, k, dest: (original(bucket, k, dest),
                                                 dest.write_bytes(b"other!!!"))
    assert cloud_ports.R2OutputVerifier().verify("ws1", output) is False


def job(input_ref, workspace: str = "ws1"):
    return SimpleNamespace(workspace_id=workspace, input_ref=input_ref)


def test_inputs_are_signed_only_for_the_jobs_own_declared_objects(r2):
    signed = cloud_ports.signed_inputs(job({"objects": ["w/ws1/a/asset1"]}))
    assert signed == [{"key": "w/ws1/a/asset1",
                       "url": "https://r2.test/sel-originals/w/ws1/a/asset1?signature=x"}]
    assert r2.signed == [("sel-originals", "w/ws1/a/asset1", 900)]
    assert cloud_ports.signed_inputs(job({})) == []
    assert cloud_ports.signed_inputs(job("not a mapping")) == []
    with pytest.raises(ValueError, match="list"):
        cloud_ports.signed_inputs(job({"objects": "w/ws1/a/asset1"}))
    with pytest.raises(ValueError, match="outside"):
        cloud_ports.signed_inputs(job({"objects": ["w/ws2/a/asset1"]}))
    with pytest.raises(ValueError, match="outside"):
        cloud_ports.signed_inputs(job({"objects": ["s/session1/object"]}))
    assert r2.closed is True


def test_an_attempts_output_prefix_comes_from_the_declared_kind_and_hash():
    declared = job({"output": {"kind": "analysis", "input_hash": HASH}})
    assert cloud_ports.output_prefix(declared, "att1") == (
        f"w/ws1/analysis/{HASH}/attempts/att1/"
    )
    assert cloud_ports.output_prefix(job({}), "att1") is None
    assert cloud_ports.output_prefix(job([]), "att1") is None
    with pytest.raises(ValueError, match="namespace"):
        cloud_ports.output_prefix(job({"output": {"kind": "../x", "input_hash": HASH}}), "a")


def test_output_slots_are_signed_under_the_attempts_own_prefix(r2):
    declared = job({"output": {"kind": "analysis", "input_hash": HASH}})
    store = SimpleNamespace(job=lambda job_id: declared)
    attempt = SimpleNamespace(id="att1", job_id="job1")
    slots = cloud_ports.signed_outputs(store, attempt, ["f.npz", "g.npz"])
    assert [slot["key"] for slot in slots] == [key(), key(name="g.npz")]
    assert all(slot["url"].endswith("?upload=x") for slot in slots)
    with pytest.raises(ValueError, match="unique"):
        cloud_ports.signed_outputs(store, attempt, ["f.npz", "f.npz"])
    nothing = SimpleNamespace(job=lambda job_id: job({}))
    with pytest.raises(ValueError, match="no declared"):
        cloud_ports.signed_outputs(nothing, attempt, ["f.npz"])
    gone = SimpleNamespace(job=lambda job_id: None)
    with pytest.raises(ValueError, match="no declared"):
        cloud_ports.signed_outputs(gone, attempt, ["f.npz"])


# --- Local mode's flags ------------------------------------------------------------------------


def test_local_jobs_follow_this_process_flags_and_an_unknown_flag_counts_as_on(monkeypatch):
    from selecta import flags
    from selecta.work.ports import ProcessFlags

    gate = ProcessFlags()
    assert gate.is_on("local", "core.analysis") is flags.on("core.analysis")
    assert gate.is_on("local", "no.such.flag") is True
    monkeypatch.setattr(flags, "on", lambda flag_id: False)
    assert gate.is_on("local", "core.analysis") is False
