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
from selecta.ai import usage_extra, usage_mode, usage_units, usage_windows
from selecta.ai.allowance import (
    bucket_for,
    classes_from,
    month_cost,
    month_key,
    record_usage,
    refund_turn,
    start_turn_unchecked,
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
from selecta.ai.usage_events import emit_usage_for_enforced_run
from selecta.billing.stripe_sync import effective_entitlement
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
    """Why Lucy stepped down, reached a limit, or fell back to the built-in planner."""
    alerts: tuple[SpendAlert, ...] = ()
    skipped: tuple[tuple[str, str], ...] = ()
    extra_offered: bool = False
    """The week is spent and the page may offer extra usage (ADR-0486): the flag is on for the
    workspace and it holds a pack balance."""
    enforced: bool = False
    """Admitted under the session and week allowance (ADR-0487), not the month's turns."""

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
    account_cost_usd: float | None = None
    """What the account was charged; `cost_usd` is what the platform booked. None when this
    call settled nothing."""
    answered_deployment_id: str | None = None


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


def _cheaper_route(
    deployments: Mapping[str, Deployment], routing: RoutingVersion, tier: Tier,
    request_class: RequestClass, workspace_id: str, health: HealthPort, needs: frozenset[str],
    route: RoutedDeployment, room_usd: float,
) -> RoutedDeployment | None:
    """The first model down `route`'s fallback chain whose turn cap fits in `room_usd`, so a
    heavy month steps down to a cheaper model instead of costing more than the plan earns."""
    skipped = (*route.skipped, (route.deployment.id, "spend"))
    step_id = route.deployment.fallback_id
    while step_id and step_id != BUILTIN_ID:
        only = RoutingVersion(routing.version, {tier.value: {request_class.value: [step_id]}})
        found = choose_route(deployments, only, tier, request_class, workspace_id, health, needs)
        if found.deployment.is_builtin:
            return None
        if turn_limits(found.deployment, tier).max_cost_usd <= room_usd:
            return replace(
                found, first_choice=route.first_choice, fallback_used=True,
                skipped=skipped + found.skipped,
            )
        skipped = (*skipped, *found.skipped, (found.deployment.id, "spend"))
        step_id = found.deployment.fallback_id
    return None


def _enforced_route(
    conn: Connection, *, workspace_id: str, run_id: str, tier: Tier, plan_id: str,
    routing: RoutingVersion, deployments: Mapping[str, Deployment], health: HealthPort,
    needs: frozenset[str], policy: PlatformPolicy, now: float, room_usd: float,
    alerts: list[SpendAlert], rules: usage_mode.Rules | None = None,
) -> tuple[RoutedDeployment | None, float, str | None, str | None]:
    # Under the unit model, the request classifier cannot affect routing, admission or price.
    route_class = RequestClass.EVERYDAY
    primary = choose_route(deployments, routing, tier, route_class, workspace_id, health, needs)
    route = primary
    lighter = False
    limited = None
    while not route.deployment.is_builtin:
        cap = turn_limits(route.deployment, tier).max_cost_usd
        if cap > room_usd:
            limited = "spend"
            cheaper = _cheaper_route(
                deployments, routing, tier, route_class, workspace_id, health, needs, route,
                room_usd,
            )
            if cheaper is None:
                return None, 0.0, None, limited
            route = cheaper
            cap = turn_limits(route.deployment, tier).max_cost_usd
        reservation = reserve(conn, cap, policy, now)
        alerts.extend(reservation.alerts)
        if not reservation.admitted:
            from selecta.observability import metrics

            metrics.add("selecta_spend_ceiling_hits_total", ceiling="ai_platform")
            return None, 0.0, None, "platform"
        cause = usage_units.reserve_enforced(
            conn, workspace_id=workspace_id, run_id=run_id, plan_id=plan_id, tier=tier.value,
            now=now, allow_lighter=lighter, reserved_units=usage_windows.to_units(cap),
        )
        if cause not in {"week", "session"}:
            return route, reservation.amount_usd, reservation.day, cause or limited
        # A spent week, never a spent session, may be carried on by a prepaid pack, on the
        # model already chosen and inside the same per-turn and platform caps (ADR-0486 rule 3).
        if cause == "week" and not lighter and usage_extra.reserve(
            conn, workspace_id=workspace_id, run_id=run_id, tier=tier.value, now=now,
            reserved_units=usage_windows.to_units(cap), rules=rules,
        ):
            return route, reservation.amount_usd, reservation.day, limited
        alerts.extend(reconcile(conn, reservation.day, reservation.amount_usd, 0.0, policy))
        if cause == "week" or tier is Tier.FREE or lighter:
            return None, 0.0, None, cause

        first = deployments.get(primary.first_choice or "")
        fallback = first.fallback_id if first is not None else None
        if not fallback or fallback == BUILTIN_ID:
            return None, 0.0, None, "session"
        lighter = True
        lighter_routing = RoutingVersion(
            routing.version, {tier.value: {route_class.value: [fallback]}}
        )
        route = replace(
            choose_route(deployments, lighter_routing, tier, route_class, workspace_id, health,
                         needs),
            first_choice=primary.first_choice, fallback_used=True,
        )
    return None, 0.0, None, "no_model"


def plan_turn(
    conn: Connection, *, workspace_id: str, tier: Tier | str, request_class: RequestClass | str,
    prompt_version: str, tool_schema_version: str, conversation_id: str | None = None,
    health: HealthPort | None = None, policy: PlatformPolicy | None = None,
    needs: Iterable[str] = DEFAULT_NEEDS, timezone: str | None = "UTC",
    rules: usage_mode.Rules | None = None,
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
    mode = usage_mode.mode_for(conn, workspace_id, rules, now)
    enforced = mode == usage_mode.ENFORCED
    chosen: RoutedDeployment | None = None
    bucket: RequestClass | None = None
    reserved, spend_day, limited, extra_offered = 0.0, None, None, False
    alerts: list[SpendAlert] = []
    used_up: set[RequestClass] = set()
    if enforced:
        entitlement = effective_entitlement(conn, workspace_id, now)
        # Keep the rollback counters live without using them to decide admission. Acquire
        # their lock before the platform reservation, in the same order as settlement.
        bucket = _count_turn(conn, workspace_id, tier, requested, month)
        chosen, reserved, spend_day, limited = _enforced_route(
            conn, workspace_id=workspace_id, run_id=run_id, tier=tier, plan_id=entitlement.plan_id,
            routing=routing, deployments=deployments, health=health, needs=needs, policy=policy,
            now=now, room_usd=tier_limits.monthly_cost_ceiling_usd + CAP_TOLERANCE_USD - spent,
            alerts=alerts, rules=rules,
        )
        if chosen is None:
            _refund_turn(conn, workspace_id, month, bucket)
            bucket = None
            extra_offered = limited == "week" and usage_extra.offered(
                conn, workspace_id, rules, now
            )
        else:
            chosen = replace(chosen, request_class=requested)
    for candidate in (() if enforced else classes_from(requested)):
        route = choose_route(deployments, routing, tier, candidate, workspace_id, health, needs)
        if route.deployment.is_builtin:
            chosen, limited = route, limited or "no_model"
            break
        ceiling = tier_limits.monthly_cost_ceiling_usd + CAP_TOLERANCE_USD
        if spent + turn_limits(route.deployment, tier).max_cost_usd > ceiling:
            limited = "spend"
            # A cheaper model down this deployment's own chain may still fit (Opus, Sonnet,
            # Haiku); then a smaller class's model; then the built-in planner.
            cheaper = _cheaper_route(
                deployments, routing, tier, candidate, workspace_id, health, needs, route,
                ceiling - spent,
            )
            if cheaper is None:
                continue
            route = cheaper
        served = _served_class(routing, tier, candidate, route)
        bucket_here = bucket_for(tier, served)
        if bucket_here in used_up:
            continue
        limits = turn_limits(route.deployment, tier)
        start = _start_turn(conn, workspace_id, tier, served, month)
        if not start.admitted:
            used_up.add(bucket_here)
            limited = "allowance"
            continue
        reservation = reserve(conn, limits.max_cost_usd, policy, now)
        alerts.extend(reservation.alerts)
        if not reservation.admitted:
            _refund_turn(conn, workspace_id, month, start.bucket)
            limited = "platform"
            from selecta.observability import metrics

            metrics.add("selecta_spend_ceiling_hits_total", ceiling="ai_platform")
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
    if mode == usage_mode.SHADOW:
        # Shadow recording must never cost anyone a turn: it runs in a savepoint, and a failure
        # is counted and dropped (ADR-0487 rule 1).
        try:
            with conn.begin_nested():
                entitlement = effective_entitlement(conn, workspace_id, now)
                usage_units.record_shadow(
                    conn, workspace_id=workspace_id, run_id=run_id,
                    plan_id=entitlement.plan_id, tier=tier.value, now=now,
                )
        except Exception:
            _usage_error("record")
    elif enforced and not chosen.deployment.is_builtin:
        emit_usage_for_enforced_run(conn, workspace_id, run_id, now=now)
    return TurnPlan(
        run_id=run_id, workspace_id=workspace_id, conversation_id=conversation_id, tier=tier,
        request_class=chosen.request_class, requested_class=requested, allowance_class=bucket,
        month=month, deployment=chosen.deployment, routing_version=chosen.routing_version,
        prompt_version=prompt_version, tool_schema_version=tool_schema_version, limits=limits,
        reserved_usd=reserved, spend_day=spend_day, lease_id=lease_id,
        fallback_used=chosen.fallback_used, limited=limited, alerts=tuple(alerts),
        skipped=chosen.skipped, extra_offered=extra_offered, enforced=enforced,
    )


def _start_turn(conn, workspace_id: str, tier: Tier, served: RequestClass, month: str):
    """A business organisation's turn counts against its venues' pooled Lucy allowance
    (ADR-0448, while `business.entitlements` is on); every other account's against its plan."""
    from selecta.business import entitlement_gates

    pooled = entitlement_gates.lucy_start(conn, workspace_id, served, month)
    return pooled if pooled is not None else try_start_turn(conn, workspace_id, tier, served, month)


def _count_turn(conn, workspace_id: str, tier: Tier, requested: RequestClass, month: str):
    """On the new allowance the month's turn counts decide nothing, and are still kept so going
    back loses nothing: a business organisation's in its venue pool, anyone else's on its plan."""
    from selecta.business import entitlement_gates

    pooled = entitlement_gates.lucy_count(conn, workspace_id, requested)
    if pooled is not None:
        return pooled
    return start_turn_unchecked(conn, workspace_id, tier, requested, month)


def _refund_turn(conn, workspace_id: str, month: str, bucket) -> bool:
    from selecta.business import entitlement_gates

    if entitlement_gates.lucy_refund(conn, workspace_id, bucket):
        return True
    return refund_turn(conn, workspace_id, month, bucket)


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
    answered_id: str | None = None,
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
            _refund_turn(conn, run.workspace_id, run.usage_month, run.allowance_class)
    alerts: tuple[SpendAlert, ...] = ()
    if run.spend_day is not None:
        alerts = reconcile(conn, run.spend_day, run.reserved_usd, platform_cost, policy)
    if run.lease_id is not None:
        release_lease(conn, run.lease_id)
    now = db_now(conn)
    # The units ledger settles in a savepoint: a failure there is counted and dropped, and the
    # turn's own settlement above stands.
    try:
        with conn.begin_nested():
            if usage_units.settle(
                conn, run_id=run.id, outcome=outcome.value,
                charged_units=usage_units.charge_for(outcome.value, account_cost),
                answered_deployment_id=answered_id, now=now,
            ):
                emit_usage_for_enforced_run(conn, run.workspace_id, run.id, now=now)
    except Exception:
        _usage_error("settle")
    return TurnSummary(run.id, outcome, platform_cost, alerts, False, account_cost, answered_id)


def _usage_error(step: str) -> None:
    from selecta.observability import metrics

    metrics.add("selecta_lucy_usage_ledger_errors_total", step=step)


def finish_turn(
    conn: Connection, plan: TurnPlan | str, *, outcome: Outcome | str, tokens_in: int = 0,
    tokens_out: int = 0, cache_read_tokens: int = 0, cache_write_tokens: int = 0,
    error_code: str | None = None, policy: PlatformPolicy | None = None,
    answered_by: Deployment | None = None, earlier_cost_usd: float = 0.0,
) -> TurnSummary:
    """Settle a turn once; a second call changes nothing and says `already_finished`.

    The tokens are those of the attempt that answered, and the account is charged for them at
    the prices of `answered_by`, the deployment that answered (the pinned one unless the turn
    stepped down the model chain). `earlier_cost_usd` is what the attempts before it cost: the
    platform books it, the account doesn't pay it. Failed and incomplete turns still count
    their dollars but give the person their turn back, since they'll press "try again".
    """
    run_id = plan.run_id if isinstance(plan, TurnPlan) else plan
    run = get_run(conn, run_id)
    if run is None:
        raise GatewayError("unknown_run", f"No Lucy run {run_id}.")
    answered = answered_by or run.deployment
    cost = answered.prices.cost(tokens_in, tokens_out, cache_read_tokens, cache_write_tokens)
    earlier = max(0.0, float(earlier_cost_usd))
    return _close(
        conn, run, Outcome(outcome), tokens_in=tokens_in, tokens_out=tokens_out,
        cache_read_tokens=cache_read_tokens, cache_write_tokens=cache_write_tokens,
        account_cost=cost, platform_cost=round(cost + earlier, 8) if earlier else cost,
        error_code=error_code, policy=policy or PlatformPolicy.from_env(),
        answered_id=answered.id,
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
