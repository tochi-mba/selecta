"""Every artifact row records its inputs, versions and checksum (ADR-0397, SC-0397-03; §10.6).

The rule lives in `selecta.work.provenance`; the database backs it with NOT NULL columns, and
migration `a3f8d2c61b97` rewrote the one older provenance shape into the shared one.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
import sqlalchemy as sa
from alembic.runtime.migration import MigrationContext
from test_cloud_jobs_support import made_provenance, make_store, output, worker

from selecta.cloud_mixes import PRODUCER, revision_provenance
from selecta.mix_contract import SongRef, new_contract
from selecta.persistence import migrate, transaction
from selecta.work import artifacts as artifact_rows
from selecta.work import provenance, proxies
from selecta.work.enqueue import JobSpec
from selecta.work.errors import CompletionRejected
from selecta.work.ports import ArtifactOutput
from selecta.work.provenance import ProvenanceInvalid
from selecta.work.schema import artifacts

BEFORE = "7c1e9a4b2f30"
SHA = "e" * 64


# --- The rule --------------------------------------------------------------------------------


def without(value: dict, key: str) -> dict:
    return {name: item for name, item in value.items() if name != key}


def changed(value: dict, **values) -> dict:
    return {**value, **values}


GOOD = made_provenance("analysis")


@pytest.mark.parametrize("kind", ["analysis", "features", "seam", "playback", "stems"])
def test_built_provenance_passes_for_every_kind(kind):
    provenance.check(kind, made_provenance(kind))


@pytest.mark.parametrize(
    ("kind", "value", "complaint"),
    [
        ("analysis", None, "must record its provenance"),
        ("analysis", {}, "must record its provenance"),
        ("analysis", ["inputs"], "must record its provenance"),
        ("analysis", changed(GOOD, note="x"), "unknown keys"),
        ("analysis", without(GOOD, "inputs"), "name its inputs"),
        ("analysis", changed(GOOD, inputs={}), "name its inputs"),
        ("analysis", changed(GOOD, inputs={"source": ""}), "content hash or object key"),
        ("analysis", changed(GOOD, inputs={"source": 7}), "content hash or object key"),
        ("analysis", changed(GOOD, inputs={"window": []}), "content hash or object key"),
        ("analysis", changed(GOOD, inputs={"source": "k" * 513}), "content hash or object key"),
        ("analysis", without(GOOD, "versions"), "name its versions"),
        ("analysis", changed(GOOD, versions={}), "name its versions"),
        ("analysis", changed(GOOD, versions={"analysis": True}), "numbers or names"),
        ("analysis", changed(GOOD, versions={"analysis": -1}), "numbers or names"),
        ("analysis", changed(GOOD, versions={"analysis": ""}), "numbers or names"),
        ("seam", changed(GOOD, versions={"analysis": 3}), "render version"),
        ("seam", changed(GOOD, versions={"render": 2}), "analysis version"),
        ("playback", GOOD, "proxy version"),
        ("stems", GOOD, "model checkpoints"),
        ("analysis", changed(GOOD, models={"separator": ""}), "map names to checkpoints"),
        ("analysis", changed(GOOD, models=["htdemucs"]), "map names to checkpoints"),
        ("analysis", without(GOOD, "settings_hash"), "SHA-256 of its settings"),
        ("analysis", changed(GOOD, settings_hash="ABC"), "SHA-256 of its settings"),
        ("analysis", changed(GOOD, settings={"sample_rate": 1}), "don't match"),
    ],
)
def test_each_missing_or_wrong_piece_is_refused(kind, value, complaint):
    with pytest.raises(ProvenanceInvalid, match=complaint):
        provenance.check(kind, value)


def test_settings_are_optional_but_their_hash_is_not():
    provenance.check("analysis", without(GOOD, "settings"))
    assert provenance.build({"a": SHA}, {"render": 2})["settings_hash"] == (
        provenance.settings_hash({})
    )


@pytest.mark.parametrize("checksum", [None, "", "c", "C" * 64, "c" * 63, 7])
def test_an_output_without_a_sha256_checksum_is_refused(checksum):
    made = ArtifactOutput("analysis", SHA, ["k"], checksum, 1, GOOD)
    with pytest.raises(ProvenanceInvalid, match="SHA-256 of its bytes"):
        provenance.check_output(made)


def test_the_playback_producer_and_the_rule_agree():
    made, _ = proxies.identity(SHA, 44_100)
    provenance.check("playback", made)
    assert made["inputs"] == {"source": SHA} and made["versions"] == {"proxy": 1}


# --- The schema ------------------------------------------------------------------------------


def row(**values) -> dict:
    return {
        "id": values.pop("id", "art-1"), "workspace_id": "w1", "kind": "playback",
        "input_hash": SHA, "keys": ["w/w1/playback/x"], "checksum": "c" * 64, "size_bytes": 1,
        "provenance": made_provenance("playback"), "created_at": 1.0, "last_used_at": 1.0,
        **values,
    }


@pytest.mark.invariants_off("writes raw artifact rows to test the schema")
def test_checksum_and_provenance_are_not_null_in_the_database(cloud_engine):
    columns = {item["name"]: item for item in sa.inspect(cloud_engine).get_columns("artifacts")}
    assert columns["checksum"]["nullable"] is False
    assert columns["provenance"]["nullable"] is False
    for missing in ("checksum", "provenance"):
        with pytest.raises(sa.exc.IntegrityError):
            with transaction(cloud_engine) as connection:
                connection.execute(artifacts.insert().values(row(**{missing: None})))
    with pytest.raises(sa.exc.IntegrityError):
        with transaction(cloud_engine) as connection:
            connection.execute(artifacts.insert().values(without(row(), "provenance")))
    with transaction(cloud_engine) as connection:
        connection.execute(artifacts.insert().values(row()))


def test_writing_an_artifact_without_provenance_writes_nothing(cloud_engine):
    bare = ArtifactOutput("analysis", SHA, ["k"], "c" * 64, 1)
    with pytest.raises(ProvenanceInvalid):
        with transaction(cloud_engine, "w1") as connection:
            artifact_rows.write(connection, "w1", "job", "attempt", [output(), bare], 1.0)
    with transaction(cloud_engine) as connection:
        assert connection.execute(sa.select(sa.func.count()).select_from(artifacts)).scalar() == 0


@pytest.mark.parametrize("missing", ["checksum", "provenance"])
def test_completing_with_an_artifact_that_lacks_either_fails_as_an_engine_bug(
    cloud_engine, missing
):
    store = make_store(cloud_engine)
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    claim = store.claim("cpu-heavy", worker())
    good = output()
    bare = ArtifactOutput(
        good.kind, good.input_hash, good.keys,
        None if missing == "checksum" else good.checksum, good.size_bytes,
        None if missing == "provenance" else good.provenance,
    )
    with pytest.raises(CompletionRejected) as rejected:
        store.complete(claim.attempt_id, claim.fencing_token, artifacts=[bare])
    assert rejected.value.error_class == "engine_bug"
    assert store.job(job.id).error_class == "engine_bug"
    assert store.find_artifact("w1", "analysis", good.input_hash) is None


# --- The migration ---------------------------------------------------------------------------


def legacy_playback(source: str, rate: int) -> dict:
    return {"source_sha256": source, "sample_rate": rate, "proxy_version": 1, "codec": "flac",
            "bits": 24}


@pytest.mark.invariants_off("writes old-shape artifact rows to test the migration")
def test_the_migration_rewrites_old_playback_rows_and_rolls_back_and_forward(cloud_engine):
    migrate.downgrade(cloud_engine, BEFORE)
    flat = legacy_playback(SHA, 48_000)
    _, input_hash = proxies.identity(SHA, 48_000)
    with transaction(cloud_engine) as connection:
        connection.execute(artifacts.insert().values(
            row(provenance=flat, input_hash=input_hash)
        ))
        connection.execute(artifacts.insert().values(
            row(id="art-2", kind="seam", provenance=made_provenance("seam"))
        ))
    migrate.upgrade(cloud_engine)

    def stored() -> dict:
        with transaction(cloud_engine) as connection:
            return dict(connection.execute(sa.select(artifacts.c.id, artifacts.c.provenance)).all())

    rewritten = stored()
    assert rewritten["art-1"] == proxies.identity(SHA, 48_000)[0]
    assert rewritten["art-2"] == made_provenance("seam")
    provenance.check("playback", rewritten["art-1"])
    assert migrate.pending_changes(cloud_engine) == []

    migrate.downgrade(cloud_engine, BEFORE)
    nullable = {c["name"]: c["nullable"] for c in sa.inspect(cloud_engine).get_columns("artifacts")}
    assert nullable["checksum"] and nullable["provenance"]
    assert stored() == rewritten
    migrate.upgrade(cloud_engine)
    assert stored() == rewritten
    assert migrate.current(cloud_engine) == migrate.head()
    assert migrate.pending_changes(cloud_engine) == []


@pytest.mark.parametrize("missing", ["checksum", "provenance"])
@pytest.mark.invariants_off("leaves an artifact row the migration refuses")
def test_the_migration_stops_rather_than_invent_a_history(cloud_engine, missing):
    migrate.downgrade(cloud_engine, BEFORE)
    # A merge revision can leave another valid migration branch at this target.
    # Compare the complete set of heads, not the single-head convenience API.
    with cloud_engine.connect() as connection:
        before_heads = frozenset(MigrationContext.configure(connection).get_current_heads())
    with transaction(cloud_engine) as connection:
        connection.execute(artifacts.insert().values(row(**{missing: None})))
    with pytest.raises(RuntimeError, match="1 artifact rows"):
        migrate.upgrade(cloud_engine)
    with cloud_engine.connect() as connection:
        after_heads = frozenset(MigrationContext.configure(connection).get_current_heads())
    assert after_heads == before_heads


# --- Frozen Cloud mix revision manifests ---------------------------------------------------


def sample_cloud_mix():
    return new_contract(
        "mix-1", "Evening", "cloud",
        (
            SongRef(source="cloud", id="asset-1", title="One", sha256="a" * 64),
            SongRef(source="cloud", id="asset-2", title="Two", sha256="b" * 64),
        ),
    )


@pytest.mark.parametrize("edited", [False, True])
def test_mix_revision_provenance_preserves_song_inputs_creator_and_parent(edited):
    first = sample_cloud_mix()
    contract = first.edited(songs=first.songs, name="Later") if edited else first
    made = revision_provenance(contract, "user-1")
    provenance.check("mix_revision", made)
    provenance.check_output(ArtifactOutput(
        "mix_revision", contract.revision, [], contract.revision, 0, made
    ))
    assert made["versions"] == {"mix_contract": 1, "producer": PRODUCER}
    assert made["settings"]["by"] == "user-1"
    assert made["settings"]["contract"] == contract.to_json()
    assert made["inputs"]["songs"] == ["a" * 64, "b" * 64]
    assert made["inputs"].get("parent") == contract.parent


@pytest.mark.parametrize(
    "malformation",
    [
        "legacy_flat", "foreign_top_level_key", "wrong_producer", "wrong_version",
        "missing_creator", "missing_contract", "wrong_song_order", "missing_parent",
        "wrong_contract_revision", "wrong_contract_source", "unexpected_setting",
    ],
)
def test_mix_revision_malformed_provenance_is_refused(malformation):
    first = sample_cloud_mix()
    contract = first.edited(songs=first.songs, name="Later")
    made = revision_provenance(contract, "user-1")
    if malformation == "legacy_flat":
        made = {"producer": PRODUCER, "by": "user-1", "contract": contract.to_json()}
    elif malformation == "foreign_top_level_key":
        made["by"] = "user-1"
    elif malformation == "wrong_producer":
        made["versions"]["producer"] = "some.other.producer"
    elif malformation == "wrong_version":
        made["versions"]["mix_contract"] = 3
    elif malformation == "wrong_song_order":
        made["inputs"]["songs"].reverse()
    elif malformation == "missing_parent":
        del made["inputs"]["parent"]
    else:
        settings = made["settings"]
        if malformation == "missing_creator":
            settings["by"] = ""
        elif malformation == "missing_contract":
            del settings["contract"]
        elif malformation == "wrong_contract_revision":
            settings["contract"]["revision"] = "c" * 64
        elif malformation == "wrong_contract_source":
            settings["contract"]["source"] = "local"
        elif malformation == "unexpected_setting":
            settings["note"] = "unvalidated"
        made["settings_hash"] = provenance.settings_hash(settings)
    with pytest.raises(ProvenanceInvalid):
        provenance.check("mix_revision", made)


@pytest.mark.parametrize("corruption", ["input_hash", "checksum", "keys", "size_bytes"])
def test_mix_revision_manifest_cannot_disagree_with_its_content_hash(corruption):
    contract = sample_cloud_mix()
    made = revision_provenance(contract, "user-1")
    values = {
        "input_hash": contract.revision, "checksum": contract.revision,
        "keys": [], "size_bytes": 0,
    }
    values[corruption] = {
        "input_hash": "f" * 64, "checksum": "f" * 64,
        "keys": ["w/foreign/key"], "size_bytes": 1,
    }[corruption]
    with pytest.raises(ProvenanceInvalid):
        provenance.check_output(ArtifactOutput(
            "mix_revision", values["input_hash"], values["keys"],
            values["checksum"], values["size_bytes"], made
        ))


def test_mix_revision_parent_must_be_a_content_hash():
    contract = replace(sample_cloud_mix(), number=2, parent="not-a-revision-hash")
    with pytest.raises(ProvenanceInvalid, match="parent hash"):
        provenance.check("mix_revision", revision_provenance(contract, "user-1"))
