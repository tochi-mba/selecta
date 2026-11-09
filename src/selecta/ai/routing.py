"""Choosing the deployment for one Lucy turn: by tier and request class, down never up (§9.1).

The active routing version lists, for each tier and request class, the deployments to try in
order (more than one only while a new deployment is being rolled out beside the old one). The
walk then tries each listed deployment, followed by their fallback chains, and takes the first
one that:

- the tier may use (its `min_tier` is at or below the tier),
- this workspace is in the rollout for (a stable hash of deployment and workspace, so raising
  5% to 25% never drops anyone who already had it),
- is active, not draining or disabled (the emergency switch),
- the health port says is healthy (the provider circuit breaker), and
- has every capability the turn needs, for example tools.

When nothing qualifies the built-in planner answers, so Lucy degrades instead of breaking.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.engine import Connection

from selecta.ai.registry import (
    BUILTIN,
    BUILTIN_ID,
    Deployment,
    DeploymentStatus,
    RequestClass,
    RoutingVersion,
    Tier,
    active_routing,
    load_deployments,
)

__all__ = [
    "DEFAULT_NEEDS",
    "AlwaysHealthy",
    "HealthPort",
    "NoRoute",
    "RequestClass",
    "RoutedDeployment",
    "choose",
    "in_rollout",
    "resolve",
    "rollout_bucket",
]

DEFAULT_NEEDS = frozenset({"streaming", "tools"})


class HealthPort(Protocol):
    """Whether a deployment is fit to take new work right now (see `spend.ProviderGuard`)."""

    def is_healthy(self, deployment_id: str) -> bool: ...


class AlwaysHealthy:
    def is_healthy(self, deployment_id: str) -> bool:
        return True


class NoRoute(LookupError):
    """No deployment, not even the built-in planner, has what this turn needs."""


@dataclass(frozen=True)
class RoutedDeployment:
    deployment: Deployment
    routing_version: int
    tier: Tier
    request_class: RequestClass
    first_choice: str | None
    fallback_used: bool
    skipped: tuple[tuple[str, str], ...] = ()
    """Each deployment passed over on the way, with why."""


def rollout_bucket(deployment_id: str, workspace_id: str) -> int:
    """0-99, the same for a workspace and deployment on every server, forever."""
    digest = hashlib.sha256(f"{deployment_id}:{workspace_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % 100


def in_rollout(deployment: Deployment, workspace_id: str) -> bool:
    if deployment.is_builtin or deployment.rollout_percent >= 100:
        return True
    return rollout_bucket(deployment.id, workspace_id) < deployment.rollout_percent


def _order(listed: Iterable[str], deployments: Mapping[str, Deployment]) -> list[str]:
    """The listed deployments first, then each one's fallback chain, without repeats."""
    order: list[str] = []
    for deployment_id in listed:
        if deployment_id not in order:
            order.append(deployment_id)
    for deployment_id in list(order):
        step = deployments.get(deployment_id)
        while step is not None and step.fallback_id and step.fallback_id not in order:
            order.append(step.fallback_id)
            step = deployments.get(step.fallback_id)
    if BUILTIN_ID not in order:
        order.append(BUILTIN_ID)
    return order


def _why_not(
    deployment: Deployment | None, tier: Tier, workspace_id: str, health: HealthPort,
    needs: frozenset[str],
) -> str | None:
    if deployment is None:
        return "unknown"
    if not deployment.allowed_for(tier):
        return "above_tier"
    if not deployment.has(needs):
        return "missing_capability"
    if deployment.status is not DeploymentStatus.ACTIVE:
        return deployment.status.value
    if not in_rollout(deployment, workspace_id):
        return "not_in_rollout"
    if not deployment.is_builtin and not health.is_healthy(deployment.id):
        return "unhealthy"
    return None


def choose(
    deployments: Mapping[str, Deployment], routing: RoutingVersion, tier: Tier | str,
    request_class: RequestClass | str, workspace_id: str, health: HealthPort | None = None,
    needs: Iterable[str] = DEFAULT_NEEDS,
) -> RoutedDeployment:
    """The routing decision itself, without the database: easy to test and to explain."""
    tier, request_class = Tier(tier), RequestClass(request_class)
    health = health or AlwaysHealthy()
    needs = frozenset(needs)
    deployments = {**deployments}
    deployments.setdefault(BUILTIN_ID, BUILTIN)
    listed = routing.candidates(tier, request_class)
    first = listed[0] if listed else None
    skipped: list[tuple[str, str]] = []
    for deployment_id in _order(listed, deployments):
        deployment = deployments.get(deployment_id)
        reason = _why_not(deployment, tier, workspace_id, health, needs)
        if reason is None and deployment is not None:
            return RoutedDeployment(
                deployment=deployment, routing_version=routing.version, tier=tier,
                request_class=request_class, first_choice=first,
                fallback_used=deployment_id not in listed, skipped=tuple(skipped),
            )
        skipped.append((deployment_id, reason or "unknown"))
    raise NoRoute(
        f"No deployment for {tier.value}/{request_class.value} has {sorted(needs)}: {skipped}"
    )


def resolve(
    conn: Connection, tier: Tier | str, request_class: RequestClass | str, workspace_id: str,
    health: HealthPort | None = None, *, needs: Iterable[str] = DEFAULT_NEEDS,
) -> RoutedDeployment:
    """The deployment a new turn should use, read from the registry and active routing."""
    return choose(
        load_deployments(conn), active_routing(conn), tier, request_class, workspace_id,
        health, needs,
    )
