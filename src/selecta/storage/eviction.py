"""Keep each workspace's derived data inside its budget, never touching what's in use (ADR-0397).

Derived data (features, playback files, stems, seam clips, waveforms) can always be made again,
so it lives under a per-workspace budget, about 15% of the plan's storage (§5.1), and the least
recently used goes first when it's over. Some of it must stay whatever the budget says. An
artifact is protected when:

- its row is marked `protected`;
- a frozen revision uses it (`revision_artifacts.frozen`, for an exported or kept mix); or
- a revision playing now uses it: any of the workspace's playback sessions (one per business
  zone, ADR-0443) names that revision and is playing or paused; or
- a kiosk reports that revision cached for offline playback (ADR-0446), through the provider
  installed with `set_cached_revisions` (none until offline playback installs one).

`pin` records which artifacts a revision uses and `unpin` forgets a revision. `evict` takes the
workspace's artifact rows in least-recently-used order (`last_used_at`, which every reuse
updates), skips the protected ones, and deletes rows until the total fits. The objects go after
the rows have committed: a crash in between leaves an orphaned object for the garbage collector,
never a row pointing at nothing. A playback file evicted this way is made again by `play.proxy`
the next time a song needs it (`work/proxies.py`).

Exports are not derived data: a kept export counts against the plan's storage (ADR-0402), not
this budget, and leaves only through plan expiry (`storage.export_expiry`), which tombstones it
and gives its bytes back. So `evict` and `over_budget` leave `export` rows out entirely.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import persistence
from selecta.playback.schema import playback_sessions
from selecta.usage import quota
from selecta.work.schema import artifacts, revision_artifacts

DERIVED_SHARE = 0.15
"""A workspace's derived data may use this share of its plan's storage (§5.1)."""
LIVE_PLAYBACK = ("playing", "paused")
EXPORT_KIND = "export"
DERIVED = artifacts.c.kind != EXPORT_KIND


@dataclass(frozen=True)
class Evicted:
    workspace_id: str
    budget_bytes: int
    before_bytes: int
    after_bytes: int
    removed: tuple[str, ...]
    """Artifact ids, oldest use first."""
    protected_bytes: int
    """What the budget couldn't touch; `after_bytes` stays above budget only because of it."""


def budget_for(connection: Connection, workspace_id: str) -> int:
    """The workspace's derived-data budget: its share of the storage limit it's on."""
    return int(quota.usage(connection, workspace_id).limit_bytes * DERIVED_SHARE)


def pin(
    connection: Connection,
    workspace_id: str,
    revision_id: str,
    artifact_ids: Iterable[str],
    *,
    frozen: bool = False,
) -> None:
    """Record that a revision uses these artifacts. Pinning again can freeze, never thaw."""
    now = persistence.db_now(connection)
    for artifact_id in dict.fromkeys(artifact_ids):
        where = sa.and_(
            revision_artifacts.c.workspace_id == workspace_id,
            revision_artifacts.c.revision_id == revision_id,
            revision_artifacts.c.artifact_id == artifact_id,
        )
        held = connection.execute(sa.select(revision_artifacts).where(where)).first()
        if held is None:
            connection.execute(
                revision_artifacts.insert().values(
                    workspace_id=workspace_id,
                    revision_id=revision_id,
                    artifact_id=artifact_id,
                    frozen=frozen,
                    created_at=now,
                )
            )
        elif frozen and not held.frozen:
            connection.execute(revision_artifacts.update().where(where).values(frozen=True))


def unpin(connection: Connection, workspace_id: str, revision_id: str) -> None:
    """The revision is gone: its artifacts are evictable again unless something else holds them."""
    connection.execute(
        revision_artifacts.delete().where(
            revision_artifacts.c.workspace_id == workspace_id,
            revision_artifacts.c.revision_id == revision_id,
        )
    )


CachedRevisions = Callable[[Connection, str], set[str]]


def _no_cached_revisions(_connection: Connection, _workspace_id: str) -> set[str]:
    return set()


_cached_revisions: CachedRevisions = _no_cached_revisions


def set_cached_revisions(provider: CachedRevisions | None) -> None:
    """Install the source of revisions kiosks report cached (ADR-0446); None removes it."""
    global _cached_revisions
    _cached_revisions = provider or _no_cached_revisions


def live_revision_ids(
    connection: Connection,
    workspace_id: str,
    *,
    cached_revisions: CachedRevisions | None = None,
) -> set[str]:
    """Every revision in use now: each session's playing or paused revision, every zone's
    included, and every revision a kiosk reports cached."""
    playing = connection.execute(
        sa.select(playback_sessions.c.mix_revision_id).where(
            playback_sessions.c.workspace_id == workspace_id,
            playback_sessions.c.state.in_(LIVE_PLAYBACK),
            playback_sessions.c.mix_revision_id.is_not(None),
        )
    ).scalars()
    provider = cached_revisions or _cached_revisions
    return {revision for revision in playing if revision} | set(
        provider(connection, workspace_id) or ()
    )


def protected_ids(
    connection: Connection,
    workspace_id: str,
    *,
    cached_revisions: CachedRevisions | None = None,
) -> set[str]:
    """Every artifact of the workspace that eviction must leave alone."""
    live = live_revision_ids(connection, workspace_id, cached_revisions=cached_revisions)
    in_use = [revision_artifacts.c.frozen.is_(True)]
    if live:
        in_use.append(revision_artifacts.c.revision_id.in_(sorted(live)))
    held = sa.select(revision_artifacts.c.artifact_id).where(
        revision_artifacts.c.workspace_id == workspace_id, sa.or_(*in_use)
    )
    marked = sa.select(artifacts.c.id).where(
        artifacts.c.workspace_id == workspace_id, artifacts.c.protected.is_(True)
    )
    return set(connection.execute(held).scalars()) | set(connection.execute(marked).scalars())


def evict(
    engine: Engine,
    workspace_id: str,
    store,
    *,
    budget_bytes: int | None = None,
    cached_revisions: CachedRevisions | None = None,
) -> Evicted:
    """Bring one workspace's derived data under budget, least recently used first."""
    with persistence.transaction(engine, workspace_id) as connection:
        budget = budget_for(connection, workspace_id) if budget_bytes is None else budget_bytes
        # A waiting lock on the workspace's rows: a reuse marking one as used right now must
        # finish first, so we never evict what was just handed out.
        rows = connection.execute(
            sa.select(artifacts.c.id, artifacts.c["keys"], artifacts.c.size_bytes)
            .where(artifacts.c.workspace_id == workspace_id, DERIVED)
            .order_by(artifacts.c.last_used_at, artifacts.c.id)
            .with_for_update()
        ).all()
        keep = protected_ids(connection, workspace_id, cached_revisions=cached_revisions)
        before = sum(int(row.size_bytes or 0) for row in rows)
        total, removed, keys = before, [], []
        for row in rows:
            if total <= budget:
                break
            if row.id in keep:
                continue
            removed.append(row.id)
            total -= int(row.size_bytes or 0)
            stored = row._mapping["keys"]
            keys += stored if isinstance(stored, list) else [stored]
        if removed:
            connection.execute(artifacts.delete().where(artifacts.c.id.in_(removed)))
            connection.execute(
                revision_artifacts.delete().where(
                    revision_artifacts.c.workspace_id == workspace_id,
                    revision_artifacts.c.artifact_id.in_(removed),
                )
            )
        protected = sum(int(row.size_bytes or 0) for row in rows if row.id in keep)
    for key in keys:
        store.delete(key)
    return Evicted(workspace_id, budget, before, total, tuple(removed), protected)


def over_budget(engine: Engine) -> list[str]:
    """Workspaces whose derived data is over budget now, for the maintenance sweep."""
    with persistence.transaction(engine) as connection:
        sizes = connection.execute(
            sa.select(artifacts.c.workspace_id, sa.func.sum(artifacts.c.size_bytes))
            .where(DERIVED)
            .group_by(artifacts.c.workspace_id)
        ).all()
        return sorted(
            workspace
            for workspace, total in sizes
            if int(total or 0) > budget_for(connection, workspace)
        )


__all__ = [
    "DERIVED_SHARE",
    "Evicted",
    "budget_for",
    "evict",
    "live_revision_ids",
    "over_budget",
    "pin",
    "protected_ids",
    "set_cached_revisions",
    "unpin",
]
