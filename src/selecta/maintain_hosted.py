"""Hosted-mode tasks for `selecta maintain` (kept out of `maintain.py`, which is near its size).

- `derived_gc` (hourly): derived files no row or live job names, and playback files unused for
  30 days (`storage.derived_gc`); dry unless `cloud.derived_gc` is on. Needs the R2 settings.
- `operator_alerts` (every minute): mails the operator address about stuck queues, a gateway
  down, a failing autoscaler and a spend ceiling (`notify.operator_alerts`). Always registered,
  so the console learns whether an address is set.
"""

from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy.engine import Engine

R2_ENV = ("SELECTA_R2_ACCOUNT_ID", "SELECTA_R2_ACCESS_KEY_ID", "SELECTA_R2_SECRET_ACCESS_KEY")


def _flag_on(flag_id: str) -> bool:
    from selecta import flags

    try:
        return flags.on(flag_id)
    except KeyError:
        return False


def add_tasks(engine: Engine, env: Mapping[str, str], plan) -> None:
    from selecta.notify import operator_alerts

    plan.tasks.append(operator_alerts.task(engine, env))
    if not all(env.get(name, "").strip() for name in R2_ENV):
        plan.disabled["derived_gc"] = "set " + ", ".join(R2_ENV)
        return
    from selecta.storage import api as storage_api
    from selecta.storage import derived_gc
    from selecta.work.maintenance import Task

    collector = derived_gc.Collector(
        engine, storage_api.r2_client, storage_api.buckets().derived,
        dry_run=lambda: not _flag_on(derived_gc.FLAG))
    plan.tasks.append(Task(derived_gc.TASK_NAME, derived_gc.EVERY_S, collector))


__all__ = ["add_tasks"]
