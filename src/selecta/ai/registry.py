"""Which models Lucy may use, what each costs, and which one serves each plan (ADR-0404, §9.1-9.2).

A deployment is one way of calling a model: provider, model id, where its key lives, what it can
do (streaming, tools, structured output), its limits, prices, rollout share and the deployment to
fall back to. Plans never name models. A routing version maps each tier and request class to
deployments, and only the active version is used. Versions are never edited: a change is a new
version, and activating it switches new runs only, since every run pins what it started with.

Each deployment has a lowest tier (`min_tier`) that may use it, which is how routing goes down,
never up: a Free request can't reach Sonnet even if a routing map mistakenly lists it. The
built-in planner (`lucy/builtin.py`) is always present and always on, so Lucy degrades instead of
breaking.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass, field, replace
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai.schema import model_deployments, model_routing_versions
from selecta.persistence import db_now, new_id


class Provider(StrEnum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    BUILTIN = "builtin"


class DeploymentStatus(StrEnum):
    ACTIVE = "active"
    DRAINING = "draining"  # runs already going finish; no new runs
    DISABLED = "disabled"


class Tier(StrEnum):
    """Lucy tiers carry the plan ids, so an entitlement's plan id is a tier as it stands."""

    FREE = "free"
    STANDARD = "standard"
    PREMIUM = "premium"

    @property
    def rank(self) -> int:
        return _TIER_RANK[self]

    @property
    def capability(self) -> str:
        return TIER_CAPABILITY[self]


class RequestClass(StrEnum):
    QUICK = "quick"  # help questions, "skip this song", small edits
    EVERYDAY = "everyday"
    PLANNING = "planning"  # whole-mix planning
    DEEP_PLAN = "deep_plan"


_TIER_RANK = {Tier.FREE: 0, Tier.STANDARD: 1, Tier.PREMIUM: 2}
TIER_CAPABILITY = {
    Tier.FREE: "lucy_basic",
    Tier.STANDARD: "lucy_standard",
    Tier.PREMIUM: "lucy_advanced",
}
CAPABILITIES = frozenset({"streaming", "tools", "structured_output"})
BUILTIN_ID = "builtin"

# Published list prices per million tokens (Oct 2026), for estimates and seeds only. Re-check
# before launch; a deployment row carries its own prices, so changing them needs no code.
MODEL_PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}
CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25  # Anthropic's five-minute cache write


class RegistryError(ValueError):
    """A deployment or routing map that would break a rule above."""


@dataclass(frozen=True)
class Prices:
    input_usd_per_mtok: float
    output_usd_per_mtok: float

    def cost(
        self, tokens_in: int, tokens_out: int, cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ) -> float:
        """Dollars for one or more calls. `tokens_in` counts every input token, cached or not,
        as Lucy's providers report it; the cached share is billed at its own rate."""
        cached = max(0, cache_read_tokens) + max(0, cache_write_tokens)
        plain = max(0, tokens_in - cached)
        per_in = self.input_usd_per_mtok / 1e6
        total = (
            plain * per_in
            + max(0, cache_read_tokens) * per_in * CACHE_READ_MULTIPLIER
            + max(0, cache_write_tokens) * per_in * CACHE_WRITE_MULTIPLIER
            + max(0, tokens_out) * self.output_usd_per_mtok / 1e6
        )
        return round(total, 8)


@dataclass(frozen=True)
class Deployment:
    id: str
    provider: Provider
    model_id: str
    min_tier: Tier
    capabilities: frozenset[str]
    max_input_tokens: int
    max_output_tokens: int
    max_tool_cycles: int
    per_turn_cost_cap_usd: float
    prices: Prices
    concurrency: int
    fallback_id: str | None = None
    base_url: str | None = None
    secret_ref: str | None = None
    effort: str | None = None
    data_region: str | None = None
    rollout_percent: int = 100
    status: DeploymentStatus = DeploymentStatus.ACTIVE
    eval_passed_at: float | None = None

    @property
    def is_builtin(self) -> bool:
        return self.provider is Provider.BUILTIN

    def allowed_for(self, tier: Tier | str) -> bool:
        return Tier(tier).rank >= self.min_tier.rank

    def has(self, needs: Iterable[str]) -> bool:
        return set(needs) <= self.capabilities

    def to_json(self) -> dict[str, Any]:
        """A plain copy for pinning in a run, so later registry edits can't change that run."""
        data = asdict(self)
        data["capabilities"] = sorted(self.capabilities)
        return data

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> Deployment:
        values = dict(data)
        values["provider"] = Provider(values["provider"])
        values["min_tier"] = Tier(values["min_tier"])
        values["status"] = DeploymentStatus(values.get("status", "active"))
        values["capabilities"] = frozenset(values.get("capabilities") or ())
        values["prices"] = Prices(**values["prices"])
        return cls(**values)


@dataclass(frozen=True)
class RoutingVersion:
    version: int
    map: dict[str, dict[str, list[str]]]
    author: str = "code"
    reason: str = ""
    active: bool = False

    def candidates(self, tier: Tier | str, request_class: RequestClass | str) -> list[str]:
        return list(self.map.get(str(tier), {}).get(str(request_class), []))


def _priced(model: str) -> Prices:
    inp, out = MODEL_PRICES[model]
    return Prices(inp, out)


_TOOLS = frozenset({"streaming", "tools", "structured_output"})

BUILTIN = Deployment(
    id=BUILTIN_ID, provider=Provider.BUILTIN, model_id="builtin", min_tier=Tier.FREE,
    capabilities=frozenset({"streaming", "tools"}), max_input_tokens=0, max_output_tokens=4000,
    max_tool_cycles=6, per_turn_cost_cap_usd=0.0, prices=Prices(0.0, 0.0), concurrency=64,
    data_region="selecta",
)

# The starting registry from §9.1. Fallback chains run to the next smaller model of the same
# family and end at the built-in planner. Caps are about ten times a typical turn of each shape.
DEFAULT_DEPLOYMENTS: tuple[Deployment, ...] = (
    BUILTIN,
    Deployment(
        id="haiku-low", provider=Provider.ANTHROPIC, model_id="claude-haiku-5-5",
        min_tier=Tier.FREE, capabilities=_TOOLS, max_input_tokens=60_000,
        max_output_tokens=2_000, max_tool_cycles=4, per_turn_cost_cap_usd=0.01,
        prices=_priced("claude-haiku-5-5"), concurrency=200, fallback_id=BUILTIN_ID,
        secret_ref="env:ANTHROPIC_API_KEY", effort="low", data_region="anthropic-us",
    ),
    Deployment(
        id="haiku-medium", provider=Provider.ANTHROPIC, model_id="claude-haiku-5-5",
        min_tier=Tier.STANDARD, capabilities=_TOOLS, max_input_tokens=80_000,
        max_output_tokens=4_000, max_tool_cycles=6, per_turn_cost_cap_usd=0.02,
        prices=_priced("claude-haiku-5-5"), concurrency=200, fallback_id=BUILTIN_ID,
        secret_ref="env:ANTHROPIC_API_KEY", effort="medium", data_region="anthropic-us",
    ),
    Deployment(
        id="sonnet-medium", provider=Provider.ANTHROPIC, model_id="claude-sonnet-5-5",
        min_tier=Tier.STANDARD, capabilities=_TOOLS, max_input_tokens=120_000,
        max_output_tokens=8_000, max_tool_cycles=8, per_turn_cost_cap_usd=0.15,
        prices=_priced("claude-sonnet-5-5"), concurrency=60, fallback_id="haiku-medium",
        secret_ref="env:ANTHROPIC_API_KEY", effort="medium", data_region="anthropic-us",
    ),
    Deployment(
        id="opus-high", provider=Provider.ANTHROPIC, model_id="claude-opus-5-5",
        min_tier=Tier.PREMIUM, capabilities=_TOOLS, max_input_tokens=150_000,
        max_output_tokens=16_000, max_tool_cycles=10, per_turn_cost_cap_usd=0.60,
        prices=_priced("claude-opus-5-5"), concurrency=20, fallback_id="sonnet-medium",
        secret_ref="env:ANTHROPIC_API_KEY", effort="high", data_region="anthropic-us",
    ),
)

_Q, _E, _P, _D = (c.value for c in RequestClass)
DEFAULT_ROUTING: dict[str, dict[str, list[str]]] = {
    "free": {_Q: ["haiku-low"], _E: ["haiku-low"], _P: ["haiku-low"], _D: ["haiku-low"]},
    "standard": {
        _Q: ["haiku-medium"], _E: ["haiku-medium"], _P: ["sonnet-medium"], _D: ["sonnet-medium"],
    },
    "premium": {
        _Q: ["haiku-low"], _E: ["sonnet-medium"], _P: ["sonnet-medium"], _D: ["opus-high"],
    },
}


def _row_values(deployment: Deployment) -> dict[str, Any]:
    return {
        "id": deployment.id,
        "provider": deployment.provider.value,
        "model_id": deployment.model_id,
        "base_url": deployment.base_url,
        "secret_ref": deployment.secret_ref,
        "effort": deployment.effort,
        "min_tier": deployment.min_tier.value,
        "capabilities": {name: name in deployment.capabilities for name in sorted(CAPABILITIES)},
        "max_input_tokens": deployment.max_input_tokens,
        "max_output_tokens": deployment.max_output_tokens,
        "max_tool_cycles": deployment.max_tool_cycles,
        "per_turn_cost_cap_usd": deployment.per_turn_cost_cap_usd,
        "input_usd_per_mtok": deployment.prices.input_usd_per_mtok,
        "output_usd_per_mtok": deployment.prices.output_usd_per_mtok,
        "concurrency": deployment.concurrency,
        "data_region": deployment.data_region,
        "rollout_percent": deployment.rollout_percent,
        "fallback_id": deployment.fallback_id,
        "status": deployment.status.value,
        "eval_passed_at": deployment.eval_passed_at,
    }


def _from_row(row: Mapping[str, Any]) -> Deployment:
    caps = row["capabilities"] or {}
    names = [name for name, on in caps.items() if on] if isinstance(caps, dict) else list(caps)
    return Deployment(
        id=row["id"], provider=Provider(row["provider"]), model_id=row["model_id"],
        min_tier=Tier(row["min_tier"]), capabilities=frozenset(names),
        max_input_tokens=row["max_input_tokens"], max_output_tokens=row["max_output_tokens"],
        max_tool_cycles=row["max_tool_cycles"],
        per_turn_cost_cap_usd=float(row["per_turn_cost_cap_usd"]),
        prices=Prices(float(row["input_usd_per_mtok"]), float(row["output_usd_per_mtok"])),
        concurrency=row["concurrency"], fallback_id=row["fallback_id"], base_url=row["base_url"],
        secret_ref=row["secret_ref"], effort=row["effort"], data_region=row["data_region"],
        rollout_percent=row["rollout_percent"], status=DeploymentStatus(row["status"]),
        eval_passed_at=row["eval_passed_at"],
    )


def validate_deployment(deployment: Deployment) -> None:
    if not deployment.id or len(deployment.id) > 36:
        raise RegistryError("A deployment needs an alias of 1 to 36 characters.")
    if not set(deployment.capabilities) <= CAPABILITIES:
        raise RegistryError(f"Unknown capabilities: {set(deployment.capabilities) - CAPABILITIES}")
    if not 0 <= deployment.rollout_percent <= 100:
        raise RegistryError("Rollout is a percentage from 0 to 100.")
    if deployment.fallback_id == deployment.id:
        raise RegistryError("A deployment can't fall back to itself.")
    if deployment.is_builtin:
        return
    if deployment.provider is Provider.OPENAI and not deployment.base_url:
        raise RegistryError("An OpenAI-compatible deployment needs a base URL.")
    if not deployment.secret_ref and deployment.provider is Provider.ANTHROPIC:
        raise RegistryError("A hosted deployment needs a secret reference, never a key.")
    if deployment.prices.input_usd_per_mtok <= 0 or deployment.prices.output_usd_per_mtok <= 0:
        raise RegistryError("A hosted deployment needs prices, or its spend can't be bounded.")
    if deployment.per_turn_cost_cap_usd <= 0 or deployment.max_output_tokens <= 0:
        raise RegistryError("A hosted deployment needs a per-turn cost cap and output limit.")
    if deployment.max_tool_cycles < 1 or deployment.concurrency < 1:
        raise RegistryError("Tool cycles and concurrency must be at least 1.")


def load_deployments(conn: Connection) -> dict[str, Deployment]:
    """Every deployment by id. The built-in planner is always there and always active."""
    rows = conn.execute(sa.select(model_deployments)).mappings().all()
    found = {row["id"]: _from_row(row) for row in rows}
    builtin = found.get(BUILTIN_ID, BUILTIN)
    found[BUILTIN_ID] = replace(builtin, status=DeploymentStatus.ACTIVE, rollout_percent=100)
    return found


def get_deployment(conn: Connection, deployment_id: str) -> Deployment | None:
    return load_deployments(conn).get(deployment_id)


def save_deployment(conn: Connection, deployment: Deployment) -> None:
    """Add or replace a deployment. New runs see it at once; running ones keep their pin."""
    validate_deployment(deployment)
    now = db_now(conn)
    values = _row_values(deployment)
    exists = conn.execute(
        sa.select(model_deployments.c.id).where(model_deployments.c.id == deployment.id)
    ).first()
    if exists:
        conn.execute(
            sa.update(model_deployments)
            .where(model_deployments.c.id == deployment.id)
            .values(**values, updated_at=now)
        )
    else:
        conn.execute(
            sa.insert(model_deployments).values(**values, created_at=now, updated_at=now)
        )


def set_status(conn: Connection, deployment_id: str, status: DeploymentStatus | str) -> bool:
    """Drain or disable a deployment (the emergency switch). The built-in planner stays on."""
    status = DeploymentStatus(status)
    if deployment_id == BUILTIN_ID and status is not DeploymentStatus.ACTIVE:
        raise RegistryError("The built-in planner is the last fallback and can't be turned off.")
    result = conn.execute(
        sa.update(model_deployments)
        .where(model_deployments.c.id == deployment_id)
        .values(status=status.value, updated_at=db_now(conn))
    )
    return result.rowcount == 1


def record_eval_pass(conn: Connection, deployment_id: str, at: float | None = None) -> bool:
    """Note that the Lucy evaluation set passed for this deployment (§9.6)."""
    result = conn.execute(
        sa.update(model_deployments)
        .where(model_deployments.c.id == deployment_id)
        .values(eval_passed_at=at if at is not None else db_now(conn), updated_at=db_now(conn))
    )
    return result.rowcount == 1


def normalise_map(raw: Mapping[str, Any]) -> dict[str, dict[str, list[str]]]:
    """Accept `{tier: {class: id or [ids]}}` and return lists, preferred first."""
    out: dict[str, dict[str, list[str]]] = {}
    for tier, classes in raw.items():
        out[str(tier)] = {}
        for request_class, value in (classes or {}).items():
            ids = [value] if isinstance(value, str) else list(value or [])
            out[str(tier)][str(request_class)] = [str(item) for item in ids]
    return out


def validate_routing_map(
    raw: Mapping[str, Any], deployments: Mapping[str, Deployment], *, require_eval: bool = True
) -> dict[str, dict[str, list[str]]]:
    """Every tier and class routed, only to deployments that exist and that tier may use.

    With `require_eval`, each first choice must have passed the evaluation set (§9.6).
    """
    routing = normalise_map(raw)
    problems: list[str] = []
    for tier in Tier:
        classes = routing.get(tier.value)
        if classes is None:
            problems.append(f"{tier.value}: missing")
            continue
        for request_class in RequestClass:
            ids = classes.get(request_class.value) or []
            if not ids:
                problems.append(f"{tier.value}/{request_class.value}: no deployment")
            for position, deployment_id in enumerate(ids):
                deployment = deployments.get(deployment_id)
                if deployment is None:
                    problems.append(f"{tier.value}/{request_class.value}: {deployment_id} unknown")
                elif not deployment.allowed_for(tier):
                    problems.append(
                        f"{tier.value}/{request_class.value}: {deployment_id} is above this tier"
                    )
                elif (
                    require_eval and position == 0 and not deployment.is_builtin
                    and deployment.eval_passed_at is None
                ):
                    problems.append(f"{deployment_id} hasn't passed the evaluation set")
    extra = set(routing) - {tier.value for tier in Tier}
    if extra:
        problems.append(f"unknown tiers: {sorted(extra)}")
    if problems:
        raise RegistryError("; ".join(problems))
    return routing


def create_routing_version(
    conn: Connection, routing: Mapping[str, Any], author: str, reason: str, *,
    activate: bool = False, require_eval: bool = True,
) -> int:
    """Store a new, immutable routing version and return its number."""
    if not author or not reason:
        raise RegistryError("A routing change needs an author and a reason.")
    checked = validate_routing_map(routing, load_deployments(conn), require_eval=require_eval)
    latest = conn.execute(sa.select(sa.func.max(model_routing_versions.c.version))).scalar()
    version = (latest or 0) + 1
    conn.execute(
        sa.insert(model_routing_versions).values(
            id=new_id(), version=version, map=checked, author=author, reason=reason,
            created_at=db_now(conn), active=False,
        )
    )
    if activate:
        activate_routing_version(conn, version, require_eval=require_eval)
    return version


def activate_routing_version(
    conn: Connection, version: int, *, require_eval: bool = True
) -> None:
    """Make `version` the one new runs use; the previous active version stops being active."""
    row = conn.execute(
        sa.select(model_routing_versions).where(model_routing_versions.c.version == version)
    ).mappings().first()
    if row is None:
        raise RegistryError(f"No routing version {version}.")
    validate_routing_map(row["map"], load_deployments(conn), require_eval=require_eval)
    conn.execute(
        sa.update(model_routing_versions)
        .where(model_routing_versions.c.active.is_(True))
        .values(active=False)
    )
    conn.execute(
        sa.update(model_routing_versions)
        .where(model_routing_versions.c.version == version)
        .values(active=True, activated_at=db_now(conn))
    )


def active_routing(conn: Connection) -> RoutingVersion:
    """The active routing version, or the starting map as version 0 when none is stored yet."""
    row = conn.execute(
        sa.select(model_routing_versions).where(model_routing_versions.c.active.is_(True))
    ).mappings().first()
    if row is None:
        return RoutingVersion(version=0, map=normalise_map(DEFAULT_ROUTING), reason="default")
    return RoutingVersion(
        version=row["version"], map=normalise_map(row["map"]), author=row["author"],
        reason=row["reason"], active=True,
    )


@dataclass(frozen=True)
class SeedResult:
    deployments_added: list[str] = field(default_factory=list)
    routing_version: int | None = None


def seed_defaults(conn: Connection, author: str = "system") -> SeedResult:
    """Add the starting deployments that are missing and, when no routing version exists yet,
    store and activate the starting map. Safe to run on every start."""
    present = set(conn.execute(sa.select(model_deployments.c.id)).scalars())
    result = SeedResult()
    for deployment in DEFAULT_DEPLOYMENTS:  # ordered so each fallback exists before its users
        if deployment.id not in present:
            save_deployment(conn, deployment)
            result.deployments_added.append(deployment.id)
    any_version = conn.execute(sa.select(model_routing_versions.c.id).limit(1)).first()
    if any_version is None:
        version = create_routing_version(
            conn, DEFAULT_ROUTING, author,
            "Starting map from the proposal (§9.1); evaluation set still to run.",
            activate=True, require_eval=False,
        )
        result = replace(result, routing_version=version)
    return result
