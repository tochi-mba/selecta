"""The Lucy gateway: one place that decides, admits, pins and settles each cloud Lucy turn.

`plan_turn` runs before a turn calls any model. In one transaction it takes a run slot for the
account, routes the request (down, never up), counts the turn against the month's allowance,
checks the account's monthly dollar ceiling, reserves the turn's worst case against the platform
caps, and records the run with everything pinned. When an allowance is used up, or the class's
model would pass the monthly dollar ceiling, the turn steps down a class (a deep plan becomes a
planning turn, and so on); when nothing paid is left, or no model is reachable, the built-in
planner answers. Lucy gets smaller; it doesn't break. A turn uses the allowance of the class that
served it: a fallback to a smaller class's model counts as that class, the run records both the
class asked for and the class served, and a turn the built-in planner answers uses none.

`provider_settings_for` turns a plan into the provider and budget settings `selecta.lucy` already
understands, with the key fetched from the deployment's secret reference, never from anything
the person typed. `finish_turn` settles the run: real cost replaces the reservation, tokens and
dollars go on the month's meter, a turn that failed is given back, and the run slot is freed.
"""

from __future__ import annotations

import copy
import os
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.engine import Connection

from selecta.admin import state as emergency_state
from selecta.ai.allowance import (
    bucket_for,
    classes_from,
    month_cost,
    month_key,
    record_usage,
    refund_turn,
    try_start_turn,
)
from selecta.ai.registry import (
    BUILTIN_ID,
    Deployment,
    DeploymentStatus,
    Provider,
    RequestClass,
    RoutingVersion,
    Tier,
    active_routing,
    load_deployments,
)
from selecta.ai.routing import DEFAULT_NEEDS, AlwaysHealthy, HealthPort, NoRoute, RoutedDeployment
from selecta.ai.routing import choose as choose_route
from selecta.ai.runs import Outcome, RunRecord, finish_run, get_run, running_before, start_run
from selecta.ai.spend import (
    CAP_TOLERANCE_USD,
    TIER_LIMITS,
    PlatformPolicy,
    SpendAlert,
    TurnGuard,
    TurnLimits,
    acquire_lease,
    reconcile,
    release_lease,
    reserve,
    turn_limits,
)
from selecta.persistence import db_now, new_id

SecretLookup = Callable[[str], str | None]

SERVER_MAX_STEPS = 40
LEASE_MARGIN_SECONDS = 60
REFUNDED = frozenset({Outcome.FAILED, Outcome.INCOMPLETE, Outcome.ABANDONED})
# The ranges `selecta.lucy.settings.LIMITS` accepts, so server policy never falls outside them.
LUCY_LIMITS = {"max_cycles": (1, 12), "max_seconds": (10, 900), "max_output_tokens": (256, 32000)}
DEFAULT_URLS = {"anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com/v1"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def env_secrets(secret_ref: str) -> str | None:
    """`env:NAME` reads an environment variable. In the cloud the hosting platform's secret
    store is injected in this function's place."""
    scheme, _, name = secret_ref.partition(":")
    if scheme == "env" and name:
        return os.environ.get(name) or None
    return None


class GatewayError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class TurnRefused(GatewayError):
    """The turn can't start now (the account's run slots are busy). Nothing was counted."""


@dataclass(frozen=True)
class TurnPlan:
    run_id: str
    workspace_id: str
    conversation_id: str | None
    tier: Tier
    request_class: RequestClass
    requested_class: RequestClass
    allowance_class: RequestClass | None
    month: str
    deployment: Deployment
    routing_version: int
    prompt_version: str
    tool_schema_version: str
    limits: TurnLimits
    reserved_usd: float
    spend_day: str | None
    lease_id: str
    fallback_used: bool
    limited: str | None
    """Why this turn got less than asked: "allowance", "spend", "platform", "no_model" or None."""
    alerts: tuple[SpendAlert, ...] = ()
    skipped: tuple[tuple[str, str], ...] = ()

    @property
    def is_builtin(self) -> bool:
        return self.deployment.is_builtin

    def guard(self, clock: Callable[[], float] = time.monotonic) -> TurnGuard:
        """Per-call and per-turn ceilings for the agent loop running this plan."""
        return TurnGuard(self.limits, self.deployment.prices, clock)


@dataclass(frozen=True)
class ProviderSettings:
    provider: dict[str, Any]
    budgets: dict[str, Any]
    effort: str | None = None
    api_key: str | None = field(default=None, repr=False)

    def lucy_config(self, user_config: Mapping[str, Any]) -> dict[str, Any]:
        """The person's Lucy settings (phases, privacy) with provider and budgets from server
        policy in place of theirs, the way cloud mode hides them (§9.5)."""
        config = copy.deepcopy(dict(user_config))
        config["provider"] = dict(self.provider)
        config["budgets"] = dict(self.budgets)
        return config

    def provider_args(self) -> dict[str, Any]:
        """Keyword arguments for `AnthropicProvider` / `OpenAICompatibleProvider`, including the
        deployment's effort (Free's Haiku runs at "low"); empty for the built-in planner, which
        needs no provider."""
        if self.provider["kind"] == Provider.BUILTIN.value:
            return {}
        return {
            "api_key": self.api_key,
            "model": self.provider["model"],
            "base_url": self.provider["base_url"],
            "max_tokens": self.budgets["max_output_tokens"],
            "effort": self.effort,
        }


@dataclass(frozen=True)
class TurnSummary:
    run_id: str
    outcome: Outcome
    cost_usd: float
    alerts: tuple[SpendAlert, ...] = ()
    already_finished: bool = False


def _builtin_route(
    deployments: Mapping[str, Deployment], version: int, tier: Tier,
    request_class: RequestClass, first_choice: str | None, needs: frozenset[str],
) -> RoutedDeployment:
    builtin = deployments[BUILTIN_ID]
    if not builtin.has(needs):
        raise NoRoute(f"The built-in planner lacks {sorted(needs - builtin.capabilities)}.")
    return RoutedDeployment(builtin, version, tier, request_class, first_choice, True)


def _served_class(
    routing: RoutingVersion, tier: Tier, routed_for: RequestClass, route: RoutedDeployment
) -> RequestClass:
    """The class whose allowance a turn uses: the one it was routed for, or, when a fallback
    answered, the largest smaller class the routing map serves with that model. So a Premium deep
    plan that falls back from Opus to Sonnet counts as a planning turn, not a deep plan."""
    if route.fallback_used:
        for smaller in classes_from(routed_for)[1:]:
            if route.deployment.id in routing.candidates(tier, smaller):
                return smaller
    return routed_for


def plan_turn(
    conn: Connection, *, workspace_id: str, tier: Tier | str, request_class: RequestClass | str,
    prompt_version: str, tool_schema_version: str, conversation_id: str | None = None,
    health: HealthPort | None = None, policy: PlatformPolicy | None = None,
    needs: Iterable[str] = DEFAULT_NEEDS, timezone: str | None = "UTC",
) -> TurnPlan:
    """Admit and pin one turn. Call inside `persistence.transaction(engine, workspace_id)`;
    any error rolls every step back, so a refused turn never leaves a count or a lease."""
    tier, requested = Tier(tier), RequestClass(request_class)
    needs = frozenset(needs)
    health = health or AlwaysHealthy()
    policy = policy or PlatformPolicy.from_env()
    now = db_now(conn)
    controls = emergency_state.load(conn)
    if controls.lucy_disabled:
        raise TurnRefused("lucy_disabled", "Lucy is paused for a short while.")
    month = month_key(now, timezone)
    tier_limits = TIER_LIMITS[tier]
    run_id = new_id()
    lease_id = acquire_lease(
        conn, workspace_id, run_id, tier_limits.max_concurrent_runs,
        tier_limits.max_turn_seconds + LEASE_MARGIN_SECONDS,
    )
    if lease_id is None:
        raise TurnRefused("busy", "Lucy is still answering your last message.")

    deployments = load_deployments(conn)
    for deployment_id in controls.disabled_deployments() & set(deployments) - {BUILTIN_ID}:
        # The `lucy.deployment_disabled` emergency control: routing falls back past it.
        deployments[deployment_id] = replace(
            deployments[deployment_id], status=DeploymentStatus.DISABLED
        )
    routing = active_routing(conn)
    spent = month_cost(conn, workspace_id, month)
    chosen: RoutedDeployment | None = None
    bucket: RequestClass | None = None
    reserved, spend_day, limited = 0.0, None, None
    alerts: list[SpendAlert] = []
    used_up: set[RequestClass] = set()
    for candidate in classes_from(requested):
        route = choose_route(deployments, routing, tier, candidate, workspace_id, health, needs)
        if route.deployment.is_builtin:
            chosen, limited = route, limited or "no_model"
            break
        served = _served_class(routing, tier, candidate, route)
        bucket_here = bucket_for(tier, served)
        if bucket_here in used_up:
            continue
        limits = turn_limits(route.deployment, tier)
        ceiling = tier_limits.monthly_cost_ceiling_usd + CAP_TOLERANCE_USD
        if spent + limits.max_cost_usd > ceiling:
            limited = "spend"  # a smaller class's cheaper model may still fit
            continue
        start = try_start_turn(conn, workspace_id, tier, served, month)
        if not start.admitted:
            used_up.add(bucket_here)
            limited = "allowance"
            continue
        reservation = reserve(conn, limits.max_cost_usd, policy, now)
        alerts.extend(reservation.alerts)
        if not reservation.admitted:
            refund_turn(conn, workspace_id, month, start.bucket)
            limited = "platform"
            break
        chosen, bucket = replace(route, request_class=served), start.bucket
        reserved, spend_day = reservation.amount_usd, reservation.day
        break
    if chosen is None:
        first = routing.candidates(tier, requested)
        chosen = _builtin_route(
            deployments, routing.version, tier, requested, first[0] if first else None, needs
        )

    limits = turn_limits(chosen.deployment, tier)
    start_run(
        conn, run_id=run_id, workspace_id=workspace_id, conversation_id=conversation_id,
        deployment=chosen.deployment, routing_version=chosen.routing_version,
        prompt_version=prompt_version, tool_schema_version=tool_schema_version, tier=tier,
        request_class=chosen.request_class, requested_class=requested, usage_month=month,
        allowance_class=bucket, fallback_used=chosen.fallback_used, limited=limited,
        lease_id=lease_id, spend_day=spend_day, reserved_usd=reserved,
    )
    return TurnPlan(
        run_id=run_id, workspace_id=workspace_id, conversation_id=conversation_id, tier=tier,
        request_class=chosen.request_class, requested_class=requested, allowance_class=bucket,
        month=month, deployment=chosen.deployment, routing_version=chosen.routing_version,
        prompt_version=prompt_version, tool_schema_version=tool_schema_version, limits=limits,
        reserved_usd=reserved, spend_day=spend_day, lease_id=lease_id,
        fallback_used=chosen.fallback_used, limited=limited, alerts=tuple(alerts),
        skipped=chosen.skipped,
    )


def _clamp(name: str, value: int) -> int:
    low, high = LUCY_LIMITS[name]
    return int(min(high, max(low, value)))


def _remote(deployment: Deployment) -> bool:
    url = deployment.base_url or DEFAULT_URLS.get(deployment.provider.value, "")
    return (urlsplit(url).hostname or "") not in LOCAL_HOSTS


def provider_settings_for(plan: TurnPlan, secrets: SecretLookup = env_secrets) -> ProviderSettings:
    """Provider and budgets in `selecta.lucy.settings`' shape, from the run's pinned deployment.

    Raises `GatewayError("secret_missing")` when a hosted deployment's key can't be found, so
    the caller can finish the turn as failed (it is given back) instead of calling unkeyed.
    """
    deployment, limits = plan.deployment, plan.limits
    budgets: dict[str, Any] = {
        "max_cycles": _clamp("max_cycles", limits.max_cycles),
        "max_steps": SERVER_MAX_STEPS,
        "max_seconds": _clamp("max_seconds", limits.max_seconds),
        "max_output_tokens": _clamp("max_output_tokens", limits.max_output_tokens),
        "spend_cap_usd": None if deployment.is_builtin else limits.max_cost_usd,
    }
    if deployment.is_builtin:
        provider = {"kind": "builtin", "model": None, "base_url": None, "consent": False,
                    "remote": False}
        return ProviderSettings(provider, budgets)
    remote = _remote(deployment)
    key = secrets(deployment.secret_ref) if deployment.secret_ref else None
    if not key and (remote or deployment.provider is Provider.ANTHROPIC):
        raise GatewayError("secret_missing", f"No key found for deployment {deployment.id}.")
    provider = {
        "kind": deployment.provider.value,
        "model": deployment.model_id,
        "base_url": deployment.base_url,
        "consent": True,  # in the cloud Selecta is the operator; consent is part of signup
        "remote": remote,
    }
    return ProviderSettings(provider, budgets, deployment.effort, key)


def _close(
    conn: Connection, run: RunRecord, outcome: Outcome, *, tokens_in: int, tokens_out: int,
    cache_read_tokens: int, cache_write_tokens: int, account_cost: float,
    platform_cost: float, error_code: str | None, policy: PlatformPolicy,
) -> TurnSummary:
    if not finish_run(
        conn, run.id, outcome=outcome, tokens_in=tokens_in, tokens_out=tokens_out,
        cache_read_tokens=cache_read_tokens, cache_write_tokens=cache_write_tokens,
        cost_usd=platform_cost, error_code=error_code,
    ):
        current = get_run(conn, run.id) or run
        return TurnSummary(run.id, current.outcome, current.cost_usd, (), True)
    if run.allowance_class is not None:
        record_usage(
            conn, run.workspace_id, run.usage_month, run.allowance_class, tokens_in=tokens_in,
            tokens_out=tokens_out, cost_usd=account_cost, cache_read_tokens=cache_read_tokens,
        )
        if outcome in REFUNDED:
            refund_turn(conn, run.workspace_id, run.usage_month, run.allowance_class)
    alerts: tuple[SpendAlert, ...] = ()
    if run.spend_day is not None:
        alerts = reconcile(conn, run.spend_day, run.reserved_usd, platform_cost, policy)
    if run.lease_id is not None:
        release_lease(conn, run.lease_id)
    return TurnSummary(run.id, outcome, platform_cost, alerts)


def finish_turn(
    conn: Connection, plan: TurnPlan | str, *, outcome: Outcome | str, tokens_in: int = 0,
    tokens_out: int = 0, cache_read_tokens: int = 0, cache_write_tokens: int = 0,
    error_code: str | None = None, policy: PlatformPolicy | None = None,
) -> TurnSummary:
    """Settle a turn once; a second call changes nothing and says `already_finished`.

    Cost comes from the pinned deployment's prices. Failed and incomplete turns still count
    their dollars but give the person their turn back, since they'll press "try again".
    """
    run_id = plan.run_id if isinstance(plan, TurnPlan) else plan
    run = get_run(conn, run_id)
    if run is None:
        raise GatewayError("unknown_run", f"No Lucy run {run_id}.")
    cost = run.deployment.prices.cost(tokens_in, tokens_out, cache_read_tokens,
                                      cache_write_tokens)
    return _close(
        conn, run, Outcome(outcome), tokens_in=tokens_in, tokens_out=tokens_out,
        cache_read_tokens=cache_read_tokens, cache_write_tokens=cache_write_tokens,
        account_cost=cost, platform_cost=cost, error_code=error_code,
        policy=policy or PlatformPolicy.from_env(),
    )


def sweep_abandoned(
    conn: Connection, *, grace_seconds: float = 120.0, policy: PlatformPolicy | None = None,
    limit: int = 100,
) -> list[TurnSummary]:
    """Close runs whose server went away. Their real cost is unknown, so the platform books
    the whole reservation; the person is charged nothing and gets the turn back."""
    policy = policy or PlatformPolicy.from_env()
    now = db_now(conn)
    shortest = min(limits.max_turn_seconds for limits in TIER_LIMITS.values())
    closed = []
    for run in running_before(conn, now - shortest - grace_seconds, limit):
        if run.started_at + TIER_LIMITS[run.tier].max_turn_seconds + grace_seconds > now:
            continue
        closed.append(
            _close(
                conn, run, Outcome.ABANDONED, tokens_in=0, tokens_out=0, cache_read_tokens=0,
                cache_write_tokens=0, account_cost=0.0, platform_cost=run.reserved_usd,
                error_code="abandoned", policy=policy,
            )
        )
    return closed
