"""What a person and an operator hear when file storage fails (staging walkthrough, item 1).

A missing bucket (`NoSuchBucket`), refused credentials or a 5xx from R2 used to answer
`storage_temporarily_unavailable` with no words, which the page then said as "SelectaDJ is being
updated". It is not an update, and the person should know their file was not stored:

- the answer is 503 `storage_unavailable` with plain words and a short reference (`R-XXXX-XXXX`)
  that is also in the server log line, so support can find it;
- an operator alert (`storage.unavailable`) is raised, at most once in ten minutes for the same
  R2 error code, so a broken bucket is seen without flooding the alert list.
"""

from __future__ import annotations

import logging
import secrets

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.engine import Engine

from selecta.storage.objects import R2Error

log = logging.getLogger(__name__)

ALERT_KIND = "storage.unavailable"
ALERT_EVERY_S = 600.0
WORDS = ("We couldn't store this file right now. Nothing was lost. Try again later, or contact "
         "support with reference {reference}.")
_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def reference() -> str:
    code = "".join(secrets.choice(_LETTERS) for _ in range(8))
    return f"R-{code[:4]}-{code[4:]}"


def storage_failure(engine: Engine | None, error: R2Error) -> HTTPException:
    """The answer for a storage failure, after logging it and alerting an operator."""
    ref = reference()
    code = error.code or (f"HTTP {error.status}" if error.status else "unreachable")
    log.error("storage.unavailable %s code=%s operation=%s", ref, code, error.operation or "-")
    if engine is not None:
        try:
            _alert_once(engine, code, error.operation or "", ref)
        except Exception:  # noqa: BLE001 - the person's answer must not fail over the alert
            log.exception("storage.unavailable alert could not be written (%s)", ref)
    return HTTPException(
        status_code=503,
        detail={"code": "storage_unavailable", "message": WORDS.format(reference=ref),
                "reference": ref},
    )


def _alert_once(engine: Engine, code: str, operation: str, ref: str) -> None:
    from selecta.admin import alerts
    from selecta.admin.schema import platform_alerts
    from selecta.persistence import db_now, transaction

    with transaction(engine) as conn:
        now = db_now(conn)
        recent = conn.execute(
            sa.select(platform_alerts.c.metadata)
            .where(platform_alerts.c.kind == ALERT_KIND,
                   platform_alerts.c.created_at >= now - ALERT_EVERY_S)
        ).scalars().all()
        if any((meta or {}).get("code") == code for meta in recent):
            return
        summary = (
            "File storage refused an upload: the bucket does not exist."
            if code == "NoSuchBucket"
            else f"File storage failed ({code}); uploads cannot be stored."
        )
        alerts.raise_alert(conn, ALERT_KIND, summary,
                           metadata={"code": code, "operation": operation, "reference": ref})


__all__ = ["ALERT_KIND", "WORDS", "reference", "storage_failure"]
