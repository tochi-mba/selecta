"""The licensing maintenance pass (ADR-0449), run while `business.licensing` is on.

For every business organisation, one transaction each:
- records licence reminders due now (`licensing.reminders_tick`: 30, 14 and 3 days before a
  licence ends and daily during its grace, by email and in-app on manager devices only); the
  emails go out through the `emails` task (`business.billing_emails`);
- deletes play-log rows older than the organisation's retention (`playlog.purge_expired`, 3
  years by default). Nothing else deletes a play.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.business import licensing, playlog
from selecta.business.commercial_facts import FactsSource, SqlFacts
from selecta.persistence import db_now, transaction

TASK_NAME = "business.licensing"
EVERY_S = 3_600.0

log = logging.getLogger(__name__)


@dataclass
class LicensingReport:
    organisations: int = 0
    reminders: int = 0
    purged: int = 0
    failed: list[str] = field(default_factory=list)


def run_pass(engine: Engine, *, facts: FactsSource | None = None) -> LicensingReport:
    from selecta.identity.schema import workspaces

    facts = facts or SqlFacts()
    report = LicensingReport()
    with transaction(engine) as conn:
        ids = [r[0] for r in conn.execute(sa.select(workspaces.c.id).where(
            workspaces.c.kind == "business"))]
    for organisation_id in ids:
        report.organisations += 1
        try:
            with transaction(engine, organisation_id) as conn:
                org = facts.organisation(conn, organisation_id)
                if org is None:
                    continue
                now = float(db_now(conn))
                report.reminders += len(licensing.reminders_tick(conn, org, now))
                report.purged += playlog.purge_expired(conn, organisation_id, now)
        except Exception:  # noqa: BLE001 - one organisation must not stop the others
            log.exception("Licensing pass failed for %s", organisation_id)
            report.failed.append(organisation_id)
    return report


__all__ = ["EVERY_S", "TASK_NAME", "LicensingReport", "run_pass"]
