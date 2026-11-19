"""The business billing maintenance pass (ADR-0447), run while `business.billing` is on.

Every `EVERY_S` it walks the organisations that have a subscription row and, one transaction
each so one organisation's failure never blocks another:

- reconciles Stripe's quantities with the computed ones (`billing.reconcile`, which leaves
  enterprise contracts alone and fixes drift with an audit entry);
- rechecks an EU reverse-charge VAT number in the week before renewal
  (`billing_b2b.renewal_tax_recheck`); a failure holds the renewal and starts grace. Skipped
  (with reconciliation) when no test-mode Stripe client is set up, since both need Stripe;
- completes venue transfers whose period boundary has come (`billing_transfer.complete_due`);
- pauses downgraded venues, and zones over a venue's paid count, at their close
  (`billing_plan.apply_due_pauses`);
- warns before an Enterprise contract ends and starts grace when it has
  (`billing_contracts.tick`);
- runs dunning (`dunning.tick`): reminder emails, read-only after grace, the 72 h and 24 h stop
  warnings, and the stop itself at each venue's close. A stopped venue is refused when it next
  tries to play (`playback.zone_session.zone_take_over`).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.business import (
    billing,
    billing_b2b,
    billing_contracts,
    billing_plan,
    billing_transfer,
    dunning,
)
from selecta.business.billing_catalogue import load_price_map
from selecta.business.commercial_facts import (
    Bz3Hours,
    FactsSource,
    HoursSource,
    SqlFacts,
)
from selecta.business.commercial_schema import biz_venue_billing
from selecta.persistence import db_now, transaction

TASK_NAME = "business.billing"
EVERY_S = 15 * 60.0

log = logging.getLogger(__name__)


@dataclass
class PassReport:
    organisations: int = 0
    tax_checked: list[str] = field(default_factory=list)
    reconciled: list[str] = field(default_factory=list)
    stopped: list[str] = field(default_factory=list)
    warned: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    paused: list[str] = field(default_factory=list)
    contract_notices: list[str] = field(default_factory=list)
    transfers: list[str] = field(default_factory=list)


def run_pass(
    engine: Engine,
    client: billing.BusinessStripe | None,
    *,
    facts: FactsSource | None = None,
    hours: HoursSource | None = None,
) -> PassReport:
    """One pass: due venue transfers first, then every organisation with a subscription, a
    contract or a venue pausing after a downgrade."""
    facts = facts or SqlFacts()
    hours = hours or Bz3Hours()
    report = PassReport()
    with transaction(engine) as conn:
        report.transfers = billing_transfer.complete_due(conn, now=float(db_now(conn)))
        organisation_ids = sorted(
            set(billing.organisations_with_subscriptions(conn))
            | set(billing_contracts.organisations_with_contracts(conn))
            | {r[0] for r in conn.execute(sa.select(biz_venue_billing.c.organisation_id).where(
                biz_venue_billing.c.state == "pausing"))}
        )
    for organisation_id in organisation_ids:
        report.organisations += 1
        try:
            with transaction(engine, organisation_id) as conn:
                org = facts.organisation(conn, organisation_id)
                if org is None:
                    continue
                now = float(db_now(conn))
                report.paused += billing_plan.apply_due_pauses(conn, org, now=now, hours=hours)
                report.contract_notices += [
                    f"{organisation_id}:{sent}"
                    for sent in billing_contracts.tick(conn, org, now=now)]
                if client is not None:
                    fixed = billing.reconcile(conn, client, org, price_map=load_price_map(),
                                              now=now)
                    if fixed.drift:
                        report.reconciled.append(organisation_id)
                    if billing_b2b.renewal_tax_recheck(conn, client, org, now=now) is not None:
                        report.tax_checked.append(organisation_id)
                ticked = dunning.tick(conn, org, now=now, hours=hours)
                report.stopped += ticked.stopped
                report.warned += [venue for venue, _ in ticked.warnings]
        except Exception:  # noqa: BLE001 - one organisation must not stop the others
            log.exception("Business billing pass failed for %s", organisation_id)
            report.failed.append(organisation_id)
    return report


__all__ = ["EVERY_S", "TASK_NAME", "PassReport", "run_pass"]
