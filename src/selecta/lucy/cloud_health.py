"""Whether Cloud Lucy can reach her models, said out loud (ADR-0476, staging incident 2026-11).

Two halves:

- `report_failure`: every provider failure in a Cloud turn writes one log line (the
  conversation and turn ids, tier, deployment, HTTP status, the provider's error type and the
  first 200 characters of its message; never the key, never the prompt). A failure shaped like
  configuration (401, 403, a 400 naming a missing header, a model not found) also raises one
  `platform_alerts` row an hour, saying what is wrong and the fix, so the console shows it.
- `check`: a self-check per plan tier. It routes each tier as a turn would and asks Anthropic's
  free token-counting endpoint once per model, which proves the key, the workspace header and
  the model without spending anything. `boot_check` runs it once at startup (staging and
  production) and logs "Lucy: ready" or the exact reason. It is kept out of `/api/ready`, so a
  provider outage never takes the API down; the console's System page can call `check`.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.persistence import db_now, transaction

log = logging.getLogger("selecta.lucy.cloud")

ALERT_KIND = "lucy.provider_configuration"
ALERT_EVERY_SECONDS = 3600
BOOT_ENVIRONMENTS = frozenset({"staging", "production"})


def explain(status: int | None, detail: str, model: str | None) -> tuple[str, str]:
    """What is wrong and how to fix it, from the provider's status and words."""
    text = (detail or "").lower()
    if status == 400 and "workspace" in text:
        return ("the workspace header is missing",
                "set ANTHROPIC_WORKSPACE_ID to the Anthropic workspace for this key, or use a "
                "workspace-scoped key")
    if status == 400 and "header" in text:
        return ("a required header is missing", f"the provider said: {detail[:120]}")
    if status == 401:
        return ("the API key was refused", "replace ANTHROPIC_API_KEY with a valid key")
    if status == 403:
        return (f"this key may not use {model or 'the model'}",
                "give the key access to the model, or route the tier to another deployment")
    if status == 404:
        return (f"the model {model or ''} isn't available".replace("  ", " "),
                "check the deployment's model id in the AI registry")
    return (f"the provider answered {status or 'nothing'}", detail[:120] or "try again later")


def report_failure(
    engine: Engine, problem: Any, *, conversation: str, turn: str, tier: str,
    deployment: str, model: str | None,
) -> None:
    """One log line for every failure; an alert for configuration, at most hourly."""
    log.warning(
        "lucy provider failure conversation=%s turn=%s tier=%s deployment=%s status=%s "
        "type=%s message=%r", conversation, turn, tier, deployment,
        getattr(problem, "status", None), getattr(problem, "kind", type(problem).__name__),
        str(getattr(problem, "detail", "") or problem)[:200],
    )
    if not getattr(problem, "configuration", False):
        return
    reason, fix = explain(problem.status, problem.detail, model)
    summary = f"Lucy can't reach Anthropic: {reason}. Fix: {fix}."
    raise_once(engine, summary, {"deployment": deployment, "tier": tier,
                                 "status": problem.status, "type": problem.kind})


def raise_once(engine: Engine, summary: str, metadata: dict[str, Any]) -> None:
    from selecta.admin import alerts
    from selecta.admin.schema import platform_alerts

    try:
        with transaction(engine) as conn:
            recent = conn.execute(
                sa.select(platform_alerts.c.id)
                .where(platform_alerts.c.kind == ALERT_KIND)
                .where(platform_alerts.c.summary == summary)
                .where(platform_alerts.c.created_at > db_now(conn) - ALERT_EVERY_SECONDS)
                .limit(1)
            ).first()
            if recent is None:
                alerts.raise_alert(conn, ALERT_KIND, summary, metadata=metadata)
    except Exception:  # noqa: BLE001 - an alert must never break the turn that found the fault
        log.exception("lucy could not record a provider alert")


@dataclass(frozen=True)
class TierCheck:
    tier: str
    deployment: str
    model: str | None
    ok: bool
    reason: str
    fix: str = ""


def _probe(deployment: Any, key: str) -> tuple[bool, str, str]:
    """One free token count: proves the key, the workspace header and the model."""
    import anthropic

    workspace = os.environ.get("ANTHROPIC_WORKSPACE_ID", "").strip()
    client = anthropic.Anthropic(
        api_key=key, base_url=deployment.base_url or None, max_retries=1, timeout=15.0,
        default_headers={"anthropic-workspace-id": workspace} if workspace else None,
    )
    try:
        client.messages.count_tokens(
            model=deployment.model_id, messages=[{"role": "user", "content": "ready?"}])
        return True, "ready", ""
    except anthropic.APIStatusError as problem:
        body = getattr(problem, "body", None)
        detail = (body.get("error", {}).get("message") if isinstance(body, dict) else None)
        reason, fix = explain(problem.status_code, str(detail or problem.message),
                              deployment.model_id)
        return False, reason, fix
    except anthropic.APIConnectionError:
        return False, "Anthropic can't be reached from this server", "check the network"
    finally:
        client.close()


def check(engine: Engine) -> list[TierCheck]:
    """Each plan tier's route for an everyday turn, checked once per model."""
    from selecta.ai import gateway
    from selecta.ai.registry import Provider, RequestClass, Tier, seed_defaults
    from selecta.ai.routing import resolve

    with transaction(engine) as conn:
        seed_defaults(conn)
        routes = {tier.value: resolve(conn, tier, RequestClass.EVERYDAY, "lucy-self-check")
                  for tier in Tier}
    probed: dict[str, tuple[bool, str, str]] = {}
    found = []
    for tier, route in routes.items():
        deployment = route.deployment
        if deployment.is_builtin:
            found.append(TierCheck(tier, deployment.id, None, False,
                                   "no model is routed; the built-in planner answers",
                                   "check the AI registry's deployments and routing"))
            continue
        if deployment.id not in probed:
            key = gateway.env_secrets(deployment.secret_ref) if deployment.secret_ref else None
            if deployment.provider is not Provider.ANTHROPIC:
                probed[deployment.id] = (bool(key), "not an Anthropic deployment; not probed", "")
            elif not key:
                probed[deployment.id] = (False, "no API key is set",
                                         f"set {deployment.secret_ref.partition(':')[2]}")
            else:
                probed[deployment.id] = _probe(deployment, key)
        ok, reason, fix = probed[deployment.id]
        found.append(TierCheck(tier, deployment.id, deployment.model_id, ok, reason, fix))
    return found


def summary(results: list[TierCheck]) -> str:
    bad = [r for r in results if not r.ok]
    if not bad:
        return "Lucy: ready"
    return "Lucy: " + "; ".join(f"{r.tier} ({r.deployment}): {r.reason}" for r in bad)


def wanted() -> bool:
    flag = os.environ.get("SELECTA_LUCY_SELF_CHECK", "").strip()
    if flag:
        return flag == "1"
    return os.environ.get("SELECTA_ENV", "").strip() in BOOT_ENVIRONMENTS


def boot_check(engine: Engine) -> None:
    """At startup: say whether Lucy can answer, and raise the alert if she can't."""
    try:
        results = check(engine)
    except Exception:  # noqa: BLE001 - a self-check must never stop the API starting
        log.exception("Lucy: the self-check itself failed")
        return
    line = summary(results)
    (log.info if line == "Lucy: ready" else log.warning)(line)
    for result in results:
        if not result.ok and result.fix:
            raise_once(engine, f"Lucy can't reach Anthropic: {result.reason}. Fix: "
                               f"{result.fix}.", {"deployment": result.deployment,
                                                 "tier": result.tier})


__all__ = ["TierCheck", "boot_check", "check", "explain", "report_failure", "summary"]
