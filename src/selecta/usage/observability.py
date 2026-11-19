"""Append observable hosted-media and compute signals to the usage ledger.

Provider data-plane traffic is not wholly visible to Selecta: presigned transfers happen outside
the API. This module keeps directly observed server operations separate from URLs issued to
clients, which describe authorization only and must never be presented as completed reads/writes.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.engine import Connection

from selecta.hosted_coexistence.grant import hosted_media_granted
from selecta.usage import ledger
from selecta.usage.meters import storage_mode
from selecta.usage.schema import quota_state


def account_mode(connection: Connection, workspace_id: str) -> str:
    """Snapshot the account's storage mode alongside a signal, including grandfathered bytes."""
    row = connection.execute(
        quota_state.select().with_only_columns(
            quota_state.c.committed_bytes, quota_state.c.reserved_bytes
        ).where(quota_state.c.workspace_id == workspace_id)
    ).first()
    used = (int(row.committed_bytes or 0) + int(row.reserved_bytes or 0)) if row else 0
    mode = storage_mode(hosted_media_granted(connection, workspace_id), used)
    return "hosted" if mode == "hosted" else "default"


def observe(
    connection: Connection,
    workspace_id: str,
    kind: ledger.Kind | str,
    amount: int | float,
    *,
    source: str,
    ref: str | None = None,
    detail: Mapping[str, Any] | None = None,
) -> str:
    """Record a signal with mode and provenance captured at observation time."""
    metadata = dict(detail or {})
    metadata.update({"account_mode": account_mode(connection, workspace_id), "source": source})
    return ledger.record(connection, workspace_id, kind, amount, ref=ref, detail=metadata)


__all__ = ["account_mode", "observe"]
