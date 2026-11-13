"""Adapter from the legacy Lucy conversation runner to local-first cloud planning.

Cloud mode never binds WeftAI audio tools. A host-supplied authenticated context
provides explicitly shareable catalogue metadata; no local files are fetched.
Standalone Lucy keeps its existing (fully local) tool pipeline.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any

from selecta.lf_ai.contract import BoundaryError
from selecta.lf_ai.service import HostedBudget, HostedLucyPlanner
from selecta.lucy.providers import ProviderError


async def answer_cloud_turn(
    app: Any,
    active: Any,
    conn: Any,
    config: dict,
    ctx: Any,
    writer: Any,
    usage: dict,
) -> None:
    """Only a trusted authenticated host may supply workspace/device scope.

    Integrators attach app.lf_ai_metadata_context(conversation_id), returning
    {workspace_id, device_id, catalogue_rows}. The caller is responsible for
    authenticating the conversation and ensuring catalogue fields are consented
    and scoped. The strict boundary then validates every value before model use.
    """
    context_provider = getattr(app, "lf_ai_metadata_context", None)
    if not callable(context_provider):
        await writer.write(
            "Connect and authorise a local Selecta engine to plan against its "
            "permitted catalogue. I cannot verify music on a device from the cloud."
        )
        return
    try:
        trusted = context_provider(active.conversation)
        if asyncio.iscoroutine(trusted):
            trusted = await trusted
        if not isinstance(trusted, Mapping) or set(trusted) != {
            "workspace_id",
            "device_id",
            "catalogue_rows",
        }:
            raise BoundaryError("invalid trusted catalogue context")
        budgets = config["budgets"]
        # Hosted-only spend ceilings; legacy DSP quotas do not apply to local work.
        max_output = min(int(budgets.get("max_output_tokens", 2000)), 2000)
        max_cost = budgets.get("spend_cap_usd")
        budget = HostedBudget(
            max_output_tokens=max_output,
            max_cost_usd=min(float(max_cost), 0.03) if max_cost is not None else 0.03,
            timeout_seconds=min(float(budgets.get("max_seconds", 30)), 30.0),
        )
        from selecta.lucy.agent import make_provider

        try:
            provider = make_provider(app, conn, config)
        except ProviderError:
            provider = None
        planner = HostedLucyPlanner(budget)
        outcome = await planner.plan(
            workspace_id=trusted["workspace_id"],
            device_id=trusted["device_id"],
            user_request=ctx.turn_text,
            catalogue_rows=trusted["catalogue_rows"],
            provider=provider,
            cancelled=lambda: active.cancel.is_set(),
        )
        plan = outcome.plan
        # These are plan suggestions, NEVER validated audio readiness or DSP actions.
        ctx.emit("lf.plan.proposed", plan.to_json())
        usage.update(
            tokens_in=outcome.hosted_tokens_in,
            tokens_out=outcome.hosted_tokens_out,
            cost_usd=outcome.hosted_cost_usd,
            estimated=True,
        )
        conn.execute(
            "UPDATE lucy_runs SET tokens_in=?, tokens_out=?, usage=? WHERE id=?",
            (usage["tokens_in"], usage["tokens_out"], json.dumps(usage), active.run),
        )
        conn.commit()
        ctx.emit("run.usage", dict(usage))
        await writer.write(plan.summary)
        await writer.write(
            "\n\nThis is a suggestion only. No song is confirmed present, "
            "no transition is rendered, and no playback has started."
        )
        if outcome.fallback_reason:
            ctx.emit("lf.plan.fallback", {"reason": outcome.fallback_reason})
    except asyncio.CancelledError:
        raise
    except (BoundaryError, TypeError, ValueError, KeyError):
        # No private source data or provider error is reflected into the conversation.
        await writer.write(
            "The shared catalogue metadata was unsafe or unavailable. "
            "Nothing was sent to an AI provider or executed."
        )
