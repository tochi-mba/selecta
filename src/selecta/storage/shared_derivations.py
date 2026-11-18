"""Reuse of machine-derived data across workspaces by content fingerprint (ADR-0469).

When two accounts hold the same bytes, a deterministic derivation of those bytes (analysis, a
waveform, a beat grid) is the same for both, so it can be computed once. This module is the
only door to `shared_derivations`, and it holds three rules:

1. Possession proof for reads. A workspace may read a shared row only for a sha256 it holds as
   a live `assets` row. The server computed that hash itself from bytes the workspace uploaded
   (`uploads.accept` checks the probe), so holding the row proves holding the file. A
   metadata-only `local_songs` registration is a hash the client claimed; it grants writing the
   workspace's own catalogue row and nothing here. Browser-first members analyse on their own
   device, so they lose nothing.
2. Verified writes only. A row is written only from a result the server computed, or a client
   result the server re-verified against bytes it holds; either way the caller names the asset
   that holds the bytes, and that asset must exist with the same sha256. Anything unverifiable
   stays workspace-private, outside this table.
3. Machine data only. Payloads carrying anything a person typed or did (titles, artists,
   ratings, names, labels, notes, play history) are refused outright.

A refused read and a missing row look the same (None), so the table is never an oracle for
whether another workspace holds a file. The whole thing is behind `cloud.hosted_dedupe`; off,
reads answer None and writes are skipped, which is per-workspace behaviour exactly as before.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.persistence import db_now
from selecta.storage.schema import assets, shared_derivations

FLAG = "cloud.hosted_dedupe"
SOURCES = ("server", "verified")
# Keys that would carry user-entered or usage data. Checked case-insensitively at every depth.
USER_ENTERED = frozenset(
    {
        "title",
        "artist",
        "album",
        "rating",
        "ratings",
        "name",
        "label",
        "note",
        "notes",
        "comment",
        "comments",
        "tags",
        "plays",
        "play_count",
        "played_at",
        "history",
        "mix",
        "mixes",
    }
)
_SHA = re.compile(r"[0-9a-f]{64}")


class NotShareable(ValueError):
    """A write that breaks the sharing rules: unverified, or carrying user data."""


def _enabled() -> bool:
    try:
        return flags.on(FLAG)
    except Exception:  # an unknown or unreadable flag means no sharing, never sharing
        return False


def _user_keys(value: Any, at: str = "payload") -> list[str]:
    found: list[str] = []
    if isinstance(value, Mapping):
        for key, inner in value.items():
            if str(key).lower() in USER_ENTERED:
                found.append(f"{at}.{key}")
            found += _user_keys(inner, f"{at}.{key}")
    elif isinstance(value, list | tuple):
        for index, inner in enumerate(value):
            found += _user_keys(inner, f"{at}[{index}]")
    return found


def possession_proven(conn: Connection, workspace_id: str, sha256: str) -> bool:
    """True when this workspace holds these exact bytes as a live, server-hashed asset."""
    if not workspace_id or not _SHA.fullmatch(sha256 or ""):
        return False
    row = conn.execute(
        sa.select(assets.c.id)
        .where(
            assets.c.workspace_id == workspace_id,
            assets.c.sha256 == sha256,
            assets.c.deleted_at.is_(None),
        )
        .limit(1)
    ).first()
    return row is not None


def read_shared(
    conn: Connection, workspace_id: str, sha256: str, kind: str, analysis_version: str
) -> Any | None:
    """The shared derivation for bytes this workspace holds, or None. None also answers every
    refusal (flag off, no possession), so a caller cannot tell refused from absent."""
    if not _enabled() or not possession_proven(conn, workspace_id, sha256):
        return None
    row = conn.execute(
        sa.select(shared_derivations.c.payload).where(
            shared_derivations.c.content_sha256 == sha256,
            shared_derivations.c.kind == kind,
            shared_derivations.c.analysis_version == analysis_version,
        )
    ).first()
    return None if row is None else row.payload


def write_shared(
    conn: Connection,
    *,
    workspace_id: str,
    asset_id: str,
    sha256: str,
    kind: str,
    analysis_version: str,
    payload: Mapping[str, Any],
    source: str,
) -> bool:
    """Record a verified machine derivation. `asset_id` names the bytes the server holds (in
    `workspace_id`) that the result was computed or verified from. Returns False when the flag
    is off; raises NotShareable when the rules are broken. The first verified result wins:
    derivations are deterministic, so a second one adds nothing."""
    if source not in SOURCES:
        raise NotShareable(
            f"Only server-computed or server-verified results are shared, not {source!r}."
        )
    leaked = _user_keys(payload)
    if leaked:
        raise NotShareable(f"User-entered or usage data never joins by fingerprint: {leaked}")
    if not _enabled():
        return False
    held = conn.execute(
        sa.select(assets.c.id).where(
            assets.c.id == asset_id,
            assets.c.workspace_id == workspace_id,
            assets.c.sha256 == sha256,
            assets.c.deleted_at.is_(None),
        )
    ).first()
    if held is None:
        raise NotShareable(
            "The server does not hold these bytes, so the result cannot be verified."
        )
    exists = conn.execute(
        sa.select(shared_derivations.c.content_sha256).where(
            shared_derivations.c.content_sha256 == sha256,
            shared_derivations.c.kind == kind,
            shared_derivations.c.analysis_version == analysis_version,
        )
    ).first()
    if exists is None:
        conn.execute(
            sa.insert(shared_derivations).values(
                content_sha256=sha256,
                kind=kind,
                analysis_version=analysis_version,
                payload=dict(payload),
                source=source,
                created_at=db_now(conn),
            )
        )
    return True


def content_references(conn: Connection, sha256: str) -> int:
    """How many live assets, across every workspace, hold these bytes: the reference count for
    content-addressed storage, derived from the assets table rather than kept as a counter, so a
    tombstone replay or a restore can never leave it drifting. Platform context only (under
    row-level security a workspace transaction counts just its own rows), and never exposed
    through any route: it would tell one tenant whether another holds a file."""
    return int(
        conn.execute(
            sa.select(sa.func.count())
            .select_from(assets)
            .where(assets.c.sha256 == sha256, assets.c.deleted_at.is_(None))
        ).scalar_one()
    )


def last_reference_gone(conn: Connection, sha256: str) -> bool:
    """True once no live asset holds these bytes: the only moment shared bytes may be removed."""
    return content_references(conn, sha256) == 0


def drop_unreferenced(conn: Connection, shas: list[str]) -> int:
    """Delete shared derivations for bytes no live asset holds any more, so erasing the last
    account that held a file erases what was derived from it too. Over-deleting (for example
    when row-level security hides other workspaces' assets) only costs a recompute; the table
    is a cache. Returns the rows removed."""
    removed = 0
    for sha in sorted(set(shas)):
        if _SHA.fullmatch(sha or "") and last_reference_gone(conn, sha):
            removed += (
                conn.execute(
                    sa.delete(shared_derivations).where(shared_derivations.c.content_sha256 == sha)
                ).rowcount
                or 0
            )
    return removed
