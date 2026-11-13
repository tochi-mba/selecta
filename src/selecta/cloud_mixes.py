"""SelectaDJ Cloud mixes: planned mixes made from Cloud Library songs (ADR-0418, AV-0418-03).

A Cloud mix is a chain of immutable revisions in the shared contract (`selecta.mix_contract`).
Each revision is stored as one protected, content-addressed row in the existing `artifacts`
table (`kind="mix_revision"`, `input_hash` = the revision id, with the contract under
`provenance.settings`), so no schema migration is needed, eviction never removes one
(`protected`), and the same contents
can never be written twice under different ids. An edit adds a revision; it never rewrites one.

Songs are the workspace's own live Cloud assets, checked in the same transaction. A seam is
planned from tempo and key only where a `song_facts` artifact for that file exists (keyed by the
file's SHA-256); no Cloud analysis worker writes those yet, so today most Cloud seams are honest
plain crossfades (`basis="unanalysed"`). Nothing here renders audio or touches original bytes.

`CAPABILITIES` is the local versus Cloud map (AV-0418-01): what each side really does today,
with the source that does it. Tests hold every row to an existing source file and every Cloud
"available" row to a route the Cloud app really serves.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.mix_contract import (
    MAX_SONGS,
    ContractError,
    MixContract,
    SongFacts,
    SongRef,
    from_json,
    new_contract,
)
from selecta.persistence import db_now, new_id, transaction
from selecta.storage.schema import assets, upload_sessions
from selecta.work import provenance
from selecta.work.schema import artifacts

KIND = "mix_revision"
FACTS_KIND = "song_facts"
PRODUCER = "cloud.mix_create"


class CloudMixError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = extra


@dataclass(frozen=True)
class Capability:
    id: str
    label: str
    local: str  # "available", "partial" or "not_yet"
    cloud: str
    local_source: str
    cloud_source: str | None
    note: str


CAPABILITIES: tuple[Capability, ...] = (
    Capability(
        "plan_mix", "Make a mix from your songs", "available", "available",
        "src/selecta/planner/reel.py", "src/selecta/cloud_mixes.py",
        "Cloud mixes keep the order you choose; the local planner can also choose the order.",
    ),
    Capability(
        "shared_contract", "One mix contract", "available", "available",
        "src/selecta/mix_contract.py", "src/selecta/mix_contract.py",
        "Both sides describe a mix revision with the same frozen contract.",
    ),
    Capability(
        "revisions", "Edit without losing the earlier version", "available", "available",
        "src/selecta/mix.py", "src/selecta/cloud_mixes.py",
        "Local keeps drafts and Undo; the Cloud keeps every revision and can restore one.",
    ),
    Capability(
        "tempo_key_seams", "Seams planned from tempo and key", "available", "partial",
        "src/selecta/planner/choose.py", "src/selecta/mix_contract.py",
        "The Cloud plans from tempo and key only for songs with analysis facts; "
        "no Cloud analysis worker writes those yet, so most Cloud seams are plain crossfades.",
    ),
    Capability(
        "rendered_seams", "Rendered, beat-matched transitions", "available", "not_yet",
        "src/selecta/seam_worker.py", None,
        "Rendering transitions runs only in the local app today.",
    ),
    Capability(
        "seam_tools", "Editor, Seam Inspector and Studio lanes", "available", "not_yet",
        "src/selecta/studio.py", None,
        "The advanced creative tools stay in the local app.",
    ),
    Capability(
        "mix_export", "Export a finished mix", "available", "not_yet",
        "src/selecta/export_validation.py", None,
        "Cloud account export exists, but Cloud mixes are not rendered to a file yet.",
    ),
    Capability(
        "no_account", "Works with no account", "available", "not_yet",
        "src/selecta/api.py", None,
        "The local app needs no account and never uploads; the Cloud needs sign-in by design.",
    ),
)


def capability_map() -> list[dict[str, Any]]:
    return [
        {
            "id": cap.id,
            "label": cap.label,
            "local": cap.local,
            "cloud": cap.cloud,
            "note": cap.note,
        }
        for cap in CAPABILITIES
    ]


def _live_songs(
    conn: Connection, workspace_id: str, asset_ids: Sequence[str]
) -> dict[str, SongRef]:
    wanted = sorted(set(asset_ids))
    if not wanted:
        return {}
    rows = conn.execute(
        sa.select(
            assets.c.id,
            assets.c.sha256,
            assets.c.duration_s,
            upload_sessions.c.display_name,
        )
        .select_from(
            assets.outerjoin(
                upload_sessions,
                sa.and_(
                    upload_sessions.c.id == assets.c.id,
                    upload_sessions.c.workspace_id == assets.c.workspace_id,
                ),
            )
        )
        .where(
            assets.c.workspace_id == workspace_id,
            assets.c.deleted_at.is_(None),
            assets.c.id.in_(wanted),
        )
    ).mappings().all()
    hashes = [row["sha256"] for row in rows if row["sha256"]]
    facts = _facts(conn, workspace_id, hashes)
    return {
        row["id"]: SongRef(
            source="cloud",
            id=row["id"],
            title=row["display_name"] or "Untitled",
            duration=row["duration_s"],
            sha256=row["sha256"],
            facts=facts.get(row["sha256"] or "", SongFacts()),
        )
        for row in rows
    }


def _facts(conn: Connection, workspace_id: str, hashes: Sequence[str]) -> dict[str, SongFacts]:
    if not hashes:
        return {}
    rows = conn.execute(
        sa.select(artifacts.c.input_hash, artifacts.c.provenance).where(
            artifacts.c.workspace_id == workspace_id,
            artifacts.c.kind == FACTS_KIND,
            artifacts.c.input_hash.in_(sorted(set(hashes))),
        )
    ).all()
    found: dict[str, SongFacts] = {}
    for input_hash, record in rows:
        values = (record or {}).get("facts") or {}
        bpm = values.get("bpm")
        energy = values.get("energy")
        found[input_hash] = SongFacts(
            bpm=float(bpm) if isinstance(bpm, (int, float)) else None,
            camelot=values.get("camelot") if isinstance(values.get("camelot"), str) else None,
            energy=float(energy) if isinstance(energy, (int, float)) else None,
        )
    return found


def _songs(conn: Connection, workspace_id: str, asset_ids: Sequence[str]) -> list[SongRef]:
    if not isinstance(asset_ids, (list, tuple)) or not all(
        isinstance(item, str) and item for item in asset_ids
    ):
        raise CloudMixError("invalid_songs", "Choose songs from your Cloud Library.")
    if len(asset_ids) < 2:
        raise CloudMixError("too_few_songs", "A mix needs at least two songs.")
    if len(asset_ids) > MAX_SONGS:
        raise CloudMixError("too_many_songs", f"A mix holds at most {MAX_SONGS} songs.")
    live = _live_songs(conn, workspace_id, asset_ids)
    missing = [asset_id for asset_id in asset_ids if asset_id not in live]
    if missing:
        raise CloudMixError(
            "song_not_found",
            "Some songs are not in your Cloud Library.",
            status=404,
            missing=sorted(set(missing)),
        )
    return [live[asset_id] for asset_id in asset_ids]


def revision_provenance(contract: MixContract, user_id: str) -> dict[str, Any]:
    """A virtual mix artifact's source hashes, parent, producer and immutable contents.

    Song hashes retain their order (and repeats). The parent is a distinct input on edits;
    the creator is audit metadata, not a revision input, so different editors cannot
    silently change a content-addressed revision's identity.
    """
    return provenance.build(
        inputs={
            "songs": [song.sha256 for song in contract.songs],
            **({"parent": contract.parent} if contract.parent is not None else {}),
        },
        versions={"mix_contract": contract.version, "producer": PRODUCER},
        settings={"by": user_id, "contract": contract.to_json()},
    )


def _store(conn: Connection, workspace_id: str, contract: MixContract, user_id: str) -> None:
    made = revision_provenance(contract, user_id)
    provenance.check(KIND, made)
    now = db_now(conn)
    conn.execute(
        artifacts.insert().values(
            id=new_id(),
            workspace_id=workspace_id,
            kind=KIND,
            input_hash=contract.revision,
            keys=[],
            checksum=contract.revision,
            size_bytes=0,
            provenance=made,
            protected=True,
            created_at=now,
            last_used_at=now,
        )
    )


def _all_revisions(conn: Connection, workspace_id: str) -> list[tuple[MixContract, float]]:
    rows = conn.execute(
        sa.select(
            artifacts.c.input_hash, artifacts.c.provenance, artifacts.c.created_at
        ).where(artifacts.c.workspace_id == workspace_id, artifacts.c.kind == KIND)
    ).all()
    found = []
    for input_hash, record, created_at in rows:
        try:
            provenance.check(KIND, record)
            contract = from_json(record["settings"]["contract"])
            if contract.revision != input_hash:
                continue
            found.append((contract, float(created_at)))
        except (provenance.ProvenanceInvalid, ContractError, KeyError, TypeError, ValueError):
            continue  # damaged or incorrectly attributed rows are never served as mixes
    return found


def revisions(conn: Connection, workspace_id: str, mix_id: str) -> list[MixContract]:
    chain = [c for c, _at in _all_revisions(conn, workspace_id) if c.mix_id == mix_id]
    return sorted(chain, key=lambda contract: contract.number)


def _with_availability(conn: Connection, workspace_id: str, contract: MixContract) -> dict:
    live = _live_songs(conn, workspace_id, [song.id for song in contract.songs])
    body = contract.to_json()
    for song in body["songs"]:
        song["available"] = song["id"] in live
    return body


def create(
    engine: Engine, workspace_id: str, user_id: str, name: str, asset_ids: Sequence[str]
) -> dict[str, Any]:
    with transaction(engine, workspace_id) as conn:
        songs = _songs(conn, workspace_id, asset_ids)
        try:
            contract = new_contract(new_id(), name or "", "cloud", songs)
        except ContractError as error:
            raise CloudMixError("invalid_mix", str(error)) from error
        _store(conn, workspace_id, contract, user_id)
        return _with_availability(conn, workspace_id, contract)


def edit(
    engine: Engine,
    workspace_id: str,
    user_id: str,
    mix_id: str,
    *,
    base_revision: str,
    asset_ids: Sequence[str] | None = None,
    name: str | None = None,
    restore: str | None = None,
) -> dict[str, Any]:
    """A new revision made from the latest one. `base_revision` must be the latest, so an edit
    made from an older view is refused (`stale_revision`) instead of silently overwriting."""
    with transaction(engine, workspace_id) as conn:
        chain = revisions(conn, workspace_id, mix_id)
        if not chain:
            raise CloudMixError("mix_not_found", "That mix is not in this account.", 404)
        latest = chain[-1]
        if base_revision != latest.revision:
            raise CloudMixError(
                "stale_revision",
                "This mix changed since you opened it. Reload it to see the newest version.",
                409,
                latest=latest.revision,
            )
        if restore is not None:
            earlier = next((c for c in chain if c.revision == restore), None)
            if earlier is None:
                raise CloudMixError("revision_not_found", "That version is not in this mix.", 404)
            ids = [song.id for song in earlier.songs]
            name = earlier.name if name is None else name
        else:
            ids = list(asset_ids) if asset_ids is not None else [s.id for s in latest.songs]
        songs = _songs(conn, workspace_id, ids)
        try:
            contract = latest.edited(songs=songs, name=None if name is None else name.strip())
        except ContractError as error:
            raise CloudMixError("invalid_mix", str(error)) from error
        _store(conn, workspace_id, contract, user_id)
        return _with_availability(conn, workspace_id, contract)


def read(engine: Engine, workspace_id: str, mix_id: str) -> dict[str, Any]:
    with transaction(engine, workspace_id) as conn:
        chain = revisions(conn, workspace_id, mix_id)
        if not chain:
            raise CloudMixError("mix_not_found", "That mix is not in this account.", 404)
        return {
            "mix": _with_availability(conn, workspace_id, chain[-1]),
            "history": [
                {"revision": c.revision, "number": c.number, "name": c.name, "songs": len(c.songs)}
                for c in reversed(chain)
            ],
        }


def list_mixes(engine: Engine, workspace_id: str) -> list[dict[str, Any]]:
    with transaction(engine, workspace_id) as conn:
        latest: dict[str, tuple[MixContract, float]] = {}
        for contract, at in _all_revisions(conn, workspace_id):
            held = latest.get(contract.mix_id)
            if held is None or contract.number > held[0].number:
                latest[contract.mix_id] = (contract, at)
    ordered = sorted(latest.values(), key=lambda pair: (-pair[1], pair[0].mix_id))
    return [
        {
            "mix_id": contract.mix_id,
            "name": contract.name,
            "revision": contract.revision,
            "number": contract.number,
            "songs": len(contract.songs),
            "intelligent_seams": contract.intelligent_seams,
            "updated_at": at,
        }
        for contract, at in ordered
    ]


__all__ = [
    "CAPABILITIES",
    "FACTS_KIND",
    "KIND",
    "Capability",
    "CloudMixError",
    "capability_map",
    "create",
    "edit",
    "list_mixes",
    "read",
    "revision_provenance",
    "revisions",
]
