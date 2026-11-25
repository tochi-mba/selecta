"""Tenant isolation: one account can never read, change or learn about another account's data.

Two people sign up. Alice owns an upload, an asset, a derived file and some events. Bob then
tries every cloud route that can reach a workspace's data, two ways:

- with Alice's workspace named in `X-Workspace-ID`, which must be refused as "no such workspace"
  before anything is read or stored;
- in his own workspace with Alice's ids, which must get exactly the answer a made-up id gets,
  so a refusal never reveals that something exists.

After all that, every row of Alice's is unchanged and the object store was never asked about her
files on Bob's behalf. `test_every_cloud_route_is_classified` makes each new route join this
matrix (or be named as public or as acting only on the caller) before it can ship.
"""

from __future__ import annotations

import dataclasses
import hashlib
import time

import pytest
import sqlalchemy as sa
from cloud_helpers import cloud_settings, grant_hosted_media
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from selecta.api_cloud import create_cloud_app
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import db_now, make_engine, metadata, migrate, new_id, transaction
from selecta.storage import api as storage_api
from selecta.storage.keys import derived_key, original_key
from selecta.storage.objects import ObjectHead
from selecta.storage.schema import assets
from selecta.work.schema import outbox_events

ALICE, BOB, BOB_BRIEF = "alice-token", "bob-token", "bob-brief-token"
CONSENT = "terms-2026-11"

# Routes anyone may call: health checks, and webhooks that prove themselves by signature.
PUBLIC = {
    ("GET", "/api/status"),
    # the status banner every signed-in customer sees; it holds nothing private
    ("GET", "/api/status-banner"),
    ("GET", "/api/ready"),
    ("POST", "/api/webhooks/stripe"),
    ("POST", "/api/webhooks/workos"),
    ("POST", "/api/business/billing/stripe-webhook"),
}
# Anonymous routes are isolated by an unguessable guest/display capability cookie rather than a
# signed-in workspace. Their own API suite proves a cookie for one room cannot address another.
CAPABILITY_ONLY = {
    ("POST", "/api/guest/join"),
    ("GET", "/api/guest/rooms/{room_id}"),
    ("GET", "/api/guest/rooms/{room_id}/search"),
    ("POST", "/api/guest/rooms/{room_id}/requests"),
    ("POST", "/api/guest/rooms/{room_id}/requests/batch"),
    ("DELETE", "/api/guest/rooms/{room_id}/requests/{request_id}"),
    ("POST", "/api/guest/rooms/{room_id}/requests/{request_id}/vote"),
    ("DELETE", "/api/guest/rooms/{room_id}/requests/{request_id}/vote"),
    ("GET", "/api/guest/rooms/{room_id}/nicknames"),
    ("PUT", "/api/guest/rooms/{room_id}/nickname"),
    ("POST", "/api/guest/rooms/{room_id}/leave"),
    # Rooms for Business guests (ADR-0451): the table card's code plus the guest's HttpOnly cookie
    # scoped to /api/venue-rooms; a wrong code gets a visitor cookie and the lockout, never
    # another room (service rules in tests/test_business_rooms_*.py; no route-level test yet).
    ("POST", "/api/venue-rooms/{code}/join"),
    ("GET", "/api/venue-rooms/{code}/state"),
    ("GET", "/api/venue-rooms/{code}/search"),
    ("POST", "/api/venue-rooms/{code}/requests"),
    ("POST", "/api/venue-rooms/{code}/requests/{request_id}/vote"),
    ("POST", "/api/display/pairings"),
    ("GET", "/api/display/view"),
    ("DELETE", "/api/display/pairing"),
    # Kiosk players (ADR-0445) carry an HttpOnly kiosk token (or, unpaired, a pairing secret)
    # bound to one zone; `test_business_kiosk.py` proves one zone's token cannot reach another.
    ("POST", "/api/kiosk/pairings"),
    ("GET", "/api/kiosk/pairings/status"),
    ("POST", "/api/kiosk/heartbeat"),
    ("POST", "/api/kiosk/health"),
    ("GET", "/api/kiosk/view"),
    ("GET", "/api/kiosk/horizon"),
    ("POST", "/api/kiosk/segment-url"),
    ("POST", "/api/kiosk/resync"),
    ("POST", "/api/kiosk/pin"),
    ("GET", "/api/kiosk/requests/next"),
    ("POST", "/api/kiosk/requests/{request_id}/played"),
    ("GET", "/api/kiosk/screen-code"),
}
# Routes that act only on the signed-in person, whatever workspace a request names.
SELF_ONLY = {
    ("POST", "/api/onboarding/complete"),
    ("POST", "/api/account/sign-out-everywhere"),
    # a log line and a count about the caller's own page; reads no workspace
    ("POST", "/api/account/problem-report"),
    ("DELETE", "/api/account"),
    # ADR-0453 S1: emails REX Technologies sales from the signed-in person; reads no workspace.
    ("POST", "/api/business/pilot-interest"),
    # Staff only: starts the caller's own admin session and never reads a customer workspace.
    ("POST", "/api/admin/session"),
    # The business price list: catalogue figures only, behind business.signups targeting.
    ("GET", "/api/business/pricing"),
}
# Staff-console routes never trust a customer workspace header. Every one first requires the
# caller's server-side privileged session; the admin route tests exercise its scoped commands.
STAFF_ONLY = {
    ("GET", "/api/admin/me"),
    ("GET", "/api/admin/overview"),
    ("GET", "/api/admin/jobs"),
    ("GET", "/api/admin/jobs/{job_id}"),
    ("POST", "/api/admin/jobs/{job_id}/{command}"),
    ("GET", "/api/admin/workers"),
    # queue health per worker pool (routes/work_queue.py): platform counts, no workspace data
    ("GET", "/api/admin/work/queue"),
    ("POST", "/api/admin/workers/{worker_id}/{command}"),
    ("GET", "/api/admin/accounts"),
    ("GET", "/api/admin/accounts/{user_id}"),
    ("POST", "/api/admin/accounts/{user_id}/{command}"),
    ("POST", "/api/admin/overrides"),
    ("POST", "/api/admin/overrides/mass"),
    ("DELETE", "/api/admin/overrides/{override_id}"),
    ("GET", "/api/admin/ai"),
    ("GET", "/api/admin/security"),
    ("POST", "/api/admin/security/roles"),
    ("GET", "/api/admin/audit"),
    ("PATCH", "/api/admin/audit/{event_id}"),
    ("DELETE", "/api/admin/audit/{event_id}"),
    ("GET", "/api/admin/alerts"),
    ("GET", "/api/admin/actions"),
    ("POST", "/api/admin/actions/{action_id}/{command}"),
    ("GET", "/api/admin/emergency"),
    ("POST", "/api/admin/emergency/{control}/{command}"),
    ("GET", "/api/admin/flags"),
    ("GET", "/api/admin/flags/history"),
    ("POST", "/api/admin/flags/rollback"),
    ("GET", "/api/admin/flags/explain/{user_id}"),
    ("POST", "/api/admin/flags/{flag_id}/impact"),
    ("POST", "/api/admin/flags/{flag_id}/change"),
    ("POST", "/api/admin/flags/{flag_id}/preview"),
    ("GET", "/api/admin/takedowns"),
    ("POST", "/api/admin/takedowns"),
    ("POST", "/api/admin/takedowns/{notice_id}/{command}"),
    ("POST", "/api/admin/upload-restrictions/{workspace_id}/lift"),
    ("POST", "/api/admin/business/pilots"),
    ("GET", "/api/admin/business/pilots"),
    ("POST", "/api/admin/business/pilots/{pilot_id}/{action}"),
    ("POST", "/api/admin/business/orgs/{org_id}/billing/credit"),
    ("POST", "/api/admin/business/orgs/{org_id}/billing/refund"),
    # ADR-0448 SLO credit decisions: staff session plus business.billing.refund.
    ("GET", "/api/admin/business/orgs/{org_id}/slo-credits"),
    ("POST", "/api/admin/business/orgs/{org_id}/slo-credits/{proposal_id}/approve"),
    ("POST", "/api/admin/business/orgs/{org_id}/slo-credits/{proposal_id}/reject"),
    ("POST", "/api/admin/business/orgs/{org_id}/contracts"),
    ("POST", "/api/admin/business/orgs/{org_id}/contracts/{contract_id}/revoke"),
    ("GET", "/api/admin/flags/cloud.hosted_media/grandfather-audit"),
    ("GET", "/api/admin/flags/cloud.local_first/percentage-readiness"),
    ("GET", "/api/admin/economics/cost-per-mode"),
    ("GET", "/api/admin/economics/lucy-ceiling"),
    # The business release-gate readout reads repository records and flag rules only.
    ("GET", "/api/admin/business/rollout"),
    # The redesigned staff console (admin/routes_console.py): every route runs through the
    # privileged staff session; a customer is named by user id in the path, never by header
    ("DELETE", "/api/admin/session/changes"),
    ("GET", "/api/admin/banners"),
    ("GET", "/api/admin/billing"),
    ("GET", "/api/admin/checklist"),
    ("GET", "/api/admin/customers/{user_id}"),
    ("GET", "/api/admin/customers/{user_id}/flags"),
    ("GET", "/api/admin/customers/{user_id}/sign-ins"),
    ("GET", "/api/admin/customers/{user_id}/storage-mode"),
    ("GET", "/api/admin/customers/{user_id}/stripe"),
    ("GET", "/api/admin/lookup"),
    ("GET", "/api/admin/staff"),
    ("GET", "/api/admin/system"),
    # The Workers page (admin/routes_workers.py): platform-wide counts and controls through the
    # privileged staff session; it names pools and job types, never a customer's workspace
    ("GET", "/api/admin/hosted/status"),
    ("GET", "/api/admin/hosted/preview"),
    ("POST", "/api/admin/hosted/jobs/retry-failed"),
    ("POST", "/api/admin/hosted/jobs/expire-queued"),
    ("POST", "/api/admin/hosted/pools/{pool}/{command}"),
    ("PUT", "/api/admin/hosted/budget"),
    ("POST", "/api/admin/alerts/{alert_id}/acknowledge"),
    ("POST", "/api/admin/audit-export"),
    ("POST", "/api/admin/banners"),
    ("POST", "/api/admin/banners/{banner_id}/end"),
    ("POST", "/api/admin/customers/{user_id}/delete"),
    ("POST", "/api/admin/customers/{user_id}/notes"),
    ("POST", "/api/admin/customers/{user_id}/portal-link"),
    ("POST", "/api/admin/customers/{user_id}/sign-ins/{session_id}/revoke"),
    ("POST", "/api/admin/customers/{user_id}/sign-out"),
    ("POST", "/api/admin/customers/{user_id}/stripe/invoices/{invoice_id}/refund"),
    ("POST", "/api/admin/customers/{user_id}/stripe/invoices/{invoice_id}/retry"),
    ("POST", "/api/admin/customers/{user_id}/stripe/subscriptions/{sub_id}/cancel-at-period-end"),
    ("POST", "/api/admin/customers/{user_id}/stripe/subscriptions/{sub_id}/cancel-now"),
    ("POST", "/api/admin/customers/{user_id}/{command}"),
    ("POST", "/api/admin/overrides/mass/dry-run"),
    ("POST", "/api/admin/session/changes"),
    ("POST", "/api/admin/staff/owners"),
    ("POST", "/api/admin/staff/roles"),
    ("POST", "/api/admin/staff/roles/{assignment_id}/revoke"),
    ("POST", "/api/admin/staff/sessions/{session_id}/end"),
    ("PUT", "/api/admin/customers/{user_id}/flags/{flag_id}"),
    ("PUT", "/api/admin/customers/{user_id}/storage-mode"),
    ("PUT", "/api/admin/me/preferences/{key}"),
}
# Business routes require an organisation workspace and membership, not merely a
# personal library workspace. The dedicated Business tests exercise their tenant
# checks and the flag-guard suite proves they are disabled before rollout.
BUSINESS_SCOPED = {
    ("GET", "/api/business/billing"),
    ("POST", "/api/business/billing/preview"),
    ("PUT", "/api/business/billing/po-number"),
    ("PUT", "/api/business/billing/venues/{venue_id}/cost-centre"),
    ("PUT", "/api/business/billing/collection-method"),
    ("GET", "/api/business/billing/cost-breakdown"),
    ("POST", "/api/business/billing/checkout"),
    ("POST", "/api/business/billing/checkout/complete"),
    ("POST", "/api/business/billing/downgrade"),
    ("POST", "/api/business/billing/venues/{venue_id}/resume"),
    ("GET", "/api/business/billing/transfers"),
    ("POST", "/api/business/billing/transfers"),
    ("POST", "/api/business/billing/transfers/{transfer_id}/accept"),
    ("POST", "/api/business/billing/transfers/{transfer_id}/cancel"),
    ("GET", "/api/business/play-log/export"),
    ("GET", "/api/business/play-log/retention"),
    ("PUT", "/api/business/play-log/retention"),
    ("GET", "/api/business/venues/{venue_id}/licence/state"),
    ("POST", "/api/business/venues/{venue_id}/licence/extend"),
    ("PUT", "/api/business/library/songs/{song_id}/isrc"),
    ("GET", "/api/business/venues/{venue_id}/isrc-coverage"),
    ("GET", "/api/business/venues/{venue_id}/isrc-tracks"),
    ("GET", "/api/business/terms"),
    ("POST", "/api/business/terms/accept"),
    ("GET", "/api/business/uploads/statement"),
    ("POST", "/api/business/uploads/attestation"),
    ("GET", "/api/business/settings/mix-exports"),
    ("PUT", "/api/business/settings/mix-exports"),
    ("GET", "/api/business/orgs"),
    ("POST", "/api/business/orgs"),
    ("GET", "/api/business/orgs/{org_id}"),
    ("GET", "/api/business/venues"),
    ("POST", "/api/business/venues"),
    ("GET", "/api/business/venues/{venue_id}"),
    ("PATCH", "/api/business/venues/{venue_id}"),
    ("POST", "/api/business/venues/{venue_id}/archive"),
    ("GET", "/api/business/venues/{venue_id}/activity"),
    ("GET", "/api/business/zones"),
    ("POST", "/api/business/zones"),
    ("PATCH", "/api/business/zones/{zone_id}"),
    ("POST", "/api/business/zones/{zone_id}/archive"),
    ("GET", "/api/business/crates"),
    ("POST", "/api/business/crates"),
    ("GET", "/api/business/crates/{crate_id}"),
    ("PUT", "/api/business/crates/{crate_id}/songs"),
    ("DELETE", "/api/business/crates/{crate_id}"),
    ("GET", "/api/business/venues/{venue_id}/hours"),
    ("PUT", "/api/business/venues/{venue_id}/hours"),
    ("PUT", "/api/business/venues/{venue_id}/closing-mode"),
    ("POST", "/api/business/venues/{venue_id}/hour-exceptions"),
    ("DELETE", "/api/business/venues/{venue_id}/hour-exceptions/{exception_id}"),
    ("GET", "/api/business/venues/{venue_id}/holiday-suggestions"),
    ("POST", "/api/business/venues/{venue_id}/stay-open-late"),
    ("POST", "/api/business/venues/{venue_id}/close-now"),
    ("POST", "/api/business/venues/{venue_id}/close-now/{override_id}/undo"),
    ("GET", "/api/business/zones/{zone_id}/state"),
    # ADR-0448 usage meters, continuity and always-open: business workspace and membership.
    ("GET", "/api/business/usage"),
    ("GET", "/api/business/slo"),
    ("PUT", "/api/business/always-open"),
    ("GET", "/api/business/zones/{zone_id}/programme"),
    ("PUT", "/api/business/zones/{zone_id}/programme"),
    ("GET", "/api/business/zones/{zone_id}/offline-manifest"),
    ("POST", "/api/business/zones/{zone_id}/commands"),
    ("PUT", "/api/business/zones/{zone_id}/cache-report"),
    ("POST", "/api/kiosk/pair"),
    ("GET", "/api/business/kiosks"),
    ("GET", "/api/business/zone-alerts"),
    ("POST", "/api/business/zone-alerts/{alert_id}/acknowledge"),
    ("DELETE", "/api/devices/{device_id}/kiosk"),
    ("GET", "/api/workspaces"),
    # ADR-0450 content controls: `content/api.py` resolves the caller in the X-Workspace-ID
    # organisation (guard.actor_for) and checks one permission at the venue or zone, whose
    # organisation must match, else 404 (tests/test_business_content_routes.py).
    ("GET", "/api/business/content/rules"),
    ("PUT", "/api/business/content/rules"),
    ("GET", "/api/business/venues/{venue_id}/content/rules"),
    ("PUT", "/api/business/venues/{venue_id}/content/rules"),
    ("GET", "/api/business/content/blocklist"),
    ("POST", "/api/business/content/blocklist"),
    ("DELETE", "/api/business/content/blocklist/{entry_id}"),
    ("POST", "/api/business/zones/{zone_id}/content/overrides"),
    ("DELETE", "/api/business/zones/{zone_id}/content/overrides/{override_id}"),
    ("PUT", "/api/business/content/songs/{song_id}/explicit"),
    # `content/api_tools.py`: the same organisation resolution; zones, songs and batches of
    # another organisation answer 404 (tests/test_business_content_tools.py).
    ("GET", "/api/business/zones/{zone_id}/content/pool"),
    ("GET", "/api/business/zones/{zone_id}/content/snapshot"),
    ("GET", "/api/business/content/artist-variants"),
    ("PUT", "/api/business/content/songs/{song_id}/clean-link"),
    ("GET", "/api/business/content/songs/{song_id}"),
    ("POST", "/api/business/content/bulk/preview"),
    ("POST", "/api/business/content/bulk/apply"),
    ("POST", "/api/business/content/bulk/{batch_id}/undo"),
    ("POST", "/api/business/content/import/preview"),
    ("POST", "/api/business/content/import/apply"),
    ("GET", "/api/business/content/worth-checking"),
    # ADR-0451 Rooms for Business staff routes: `rooms/api.py` finds the zone or venue, resolves
    # the caller in that zone's organisation (a member, or a kiosk or tablet token) and checks
    # one permission there with guard.require, so another organisation's zone answers 404
    # (the service is tested in tests/test_business_rooms_*.py; no route-level test yet).
    ("GET", "/api/zones/{zone_id}/requests"),
    ("GET", "/api/zones/{zone_id}/requests/next"),
    ("POST", "/api/zones/{zone_id}/requests/{request_id}/played"),
    ("POST", "/api/zones/{zone_id}/requests/{request_id}/approve"),
    ("POST", "/api/zones/{zone_id}/requests/{request_id}/pass"),
    ("GET", "/api/zones/{zone_id}/room"),
    ("PATCH", "/api/zones/{zone_id}/room"),
    ("POST", "/api/zones/{zone_id}/room/rotate"),
    ("GET", "/api/venues/{venue_id}/room-print"),
    ("GET", "/api/zones/{zone_id}/room/screen-code"),
    ("POST", "/api/zones/{zone_id}/room/guests/{guest_id}/remove"),
    ("POST", "/api/zones/{zone_id}/room/guests/{guest_id}/ban"),
    ("POST", "/api/zones/{zone_id}/room/pause"),
    ("POST", "/api/zones/{zone_id}/room/resume"),
    ("POST", "/api/zones/{zone_id}/venue-network"),
    # ADR-0452/0453: people, invitations, overview and setup; every one resolves the caller in
    # the named organisation (guard.actor_for) and its venues by scope, 404 otherwise
    # (tests/test_business_people_routes.py proves another organisation's ids answer 404).
    ("GET", "/api/business/orgs/{org_id}/overview"),
    ("PATCH", "/api/business/orgs/{org_id}"),
    ("PUT", "/api/business/orgs/{org_id}/setup"),
    ("GET", "/api/business/people"),
    ("DELETE", "/api/business/people/{user_id}"),
    ("PUT", "/api/business/seats"),
    ("POST", "/api/business/library/copy-from-personal"),
    ("POST", "/api/business/invitations"),
    ("POST", "/api/business/invitations/{invitation_id}/revoke"),
    ("POST", "/api/business/invitations/accept"),
    ("POST", "/api/business/venues/{venue_id}/pin"),
    ("POST", "/api/business/schedules/apply"),
    ("GET", "/api/business/library/songs"),
    ("POST", "/api/business/library/explicit"),
    ("PUT", "/api/business/venues/{venue_id}/licence"),
    ("GET", "/api/business/zones/{zone_id}/speaker/horizon"),
    ("POST", "/api/business/zones/{zone_id}/speaker/segment-url"),
    # Autopilot requires membership in a Business workspace. Stateful routes also
    # check that each named venue actually belongs to that organisation.
    ("GET", "/api/autopilot/availability"),
    ("GET", "/api/autopilot/maturity"),
    ("POST", "/api/autopilot/sessions"),
    ("GET", "/api/autopilot/sessions/{session_id}"),
    ("POST", "/api/autopilot/sessions/{session_id}/controls/{control}"),
    ("POST", "/api/autopilot/sessions/{session_id}/transitions"),
    ("GET", "/api/autopilot/venues/{venue_id}/setup"),
    ("PUT", "/api/autopilot/venues/{venue_id}/setup/{step}"),
    ("GET", "/api/autopilot/venues/{venue_id}/policies"),
    ("POST", "/api/autopilot/venues/{venue_id}/policies"),
    ("GET", "/api/autopilot/venues/{venue_id}/overrides"),
    ("POST", "/api/autopilot/venues/{venue_id}/overrides"),
    ("DELETE", "/api/autopilot/venues/{venue_id}/overrides/{override_id}"),
    ("POST", "/api/autopilot/venues/{venue_id}/candidates"),
}

# The local-media catalogue ships dark (`cloud.local_media` is off in the build), so the build
# guard answers 403 before any workspace check can. Its tenant checks are proved with the flag
# forced on in `test_bf_local_media.py` (Bob cannot read, delete or report availability on
# Alice's songs), the same arrangement the Business routes have.
FLAG_DARK = {
    ("POST", "/api/local-media/songs"),
    ("GET", "/api/local-media/songs"),
    ("GET", "/api/local-media/songs/{song_id}"),
    ("DELETE", "/api/local-media/songs/{song_id}"),
    ("POST", "/api/local-media/availability"),
    # Never play on a batch of catalogue songs; Bob cannot touch Alice's songs
    # (`test_bf_local_media_never.py`).
    ("POST", "/api/local-media/songs/never"),
    # Portable recipes ride the same flag; Bob cannot list, read or edit Alice's recipes
    # (`test_bf_local_recipes.py`).
    ("GET", "/api/local-media/recipes"),
    ("POST", "/api/local-media/recipes"),
    ("GET", "/api/local-media/recipes/{mix_id}"),
    ("POST", "/api/local-media/recipes/{mix_id}/revisions"),
    ("POST", "/api/local-media/recipes/{mix_id}/duplicate"),
    ("DELETE", "/api/local-media/recipes/{mix_id}"),
    # The account's current mix (ADR-0475 R8) is one row keyed by the caller's workspace
    # (`test_bf_current_mix.py`).
    ("GET", "/api/local-media/current"),
    ("PUT", "/api/local-media/current"),
    # Word connections between catalogue songs ride `discover.word_links`, dark in Cloud while
    # `lyrics.display` is (SC-0406-03); every query is scoped to the caller's workspace.
    ("GET", "/api/local-media/links"),
    # The Labs opening for browser-first Cloud ships dark (`cloud.local_first_labs` off); its
    # routes act only on the caller's own user id and workspace (`test_bf_local_first_labs.py`).
    ("POST", "/api/account/labs/local-first/join"),
    ("POST", "/api/account/labs/local-first/feedback"),
}

# Every route that can reach a workspace's data, with a body valid enough to get past
# validation, so the refusal we see comes from the workspace check and not from a 422.
SCOPED: dict[tuple[str, str], dict | None] = {
    ("GET", "/api/events"): None,
    ("GET", "/api/cloud-mixes"): None,
    ("GET", "/api/cloud-mixes/capabilities"): None,
    ("POST", "/api/cloud-mixes"): {"name": "Tenant check", "asset_ids": []},
    ("GET", "/api/cloud-mixes/{mix_id}"): None,
    ("POST", "/api/cloud-mixes/{mix_id}/revisions"): {
        "base_revision": "0" * 64, "name": "Tenant check",
    },
    ("GET", "/api/account"): None,
    ("GET", "/api/account/labs"): None,
    ("PUT", "/api/account/labs/{flag_id}"): {"enabled": False},
    ("PUT", "/api/account/workspace-name"): {"name": "Tenant check"},
    ("GET", "/api/account/labs/local-first"): None,
    ("POST", "/api/account/labs/local-first/leave"): None,
    ("GET", "/api/account/export"): None,
    ("GET", "/api/account/lucy"): None,
    # Lucy's conversation in Cloud (ADR-0476): every route names the workspace before anything
    ("GET", "/api/lucy-cloud/status"): None,
    ("PUT", "/api/lucy-cloud/settings"): {"enabled": True},
    ("GET", "/api/lucy-cloud/conversations"): None,
    ("POST", "/api/lucy-cloud/conversations"): {},
    ("GET", "/api/lucy-cloud/conversations/{conversation}"): None,
    ("PATCH", "/api/lucy-cloud/conversations/{conversation}"): {"title": "Tenant check"},
    ("DELETE", "/api/lucy-cloud/conversations/{conversation}"): None,
    ("POST", "/api/lucy-cloud/conversations/{conversation}/turns"): {
        "client_id": "tenant", "text": "hello",
    },
    ("POST", "/api/lucy-cloud/conversations/{conversation}/retry"): {"turn": "tenant"},
    ("POST", "/api/lucy-cloud/conversations/{conversation}/stop"): None,
    ("GET", "/api/lucy-cloud/conversations/{conversation}/events.json"): None,
    ("GET", "/api/lucy-cloud/revisions/{revision}"): None,
    ("GET", "/api/lucy-cloud/revisions/{revision}/diff"): None,
    ("GET", "/api/lucy-cloud/revisions/{revision}/readiness"): None,
    ("POST", "/api/lucy-cloud/revisions/{revision}/edit"): {
        "expected": "tenant", "op": {"op": "remove", "occurrence": "0:1"},
    },
    ("POST", "/api/lucy-cloud/proposals/{proposal}/current"): {"revision": "tenant"},
    ("POST", "/api/lucy-cloud/approvals"): {"revision": "tenant", "hash": "x", "action": "draft"},
    ("POST", "/api/lucy-cloud/commits"): {"token": "tenant", "idempotency_key": "tenant"},
    ("GET", "/api/lucy-cloud/commits/{key}"): None,
    ("GET", "/api/lucy-cloud/memory"): None,
    ("POST", "/api/lucy-cloud/messages/{message}/rating"): {"rating": "up"},
    ("GET", "/api/lucy-cloud/conversations/{conversation}/messages"): None,
    ("PUT", "/api/account/lucy"): {
        "enabled": True,
        "phases": {"chat": True},
        "privacy": {"share_lyrics": False},
    },
    ("POST", "/api/billing/checkout"): {
        "plan": "premium",
        "interval": "month",
        "consent_version": CONSENT,
        "accepted_terms": True,
        "requested_immediate_access": True,
        "acknowledged_cancellation_right": True,
    },
    ("POST", "/api/billing/portal"): {"return_url": "https://app.test/account/billing"},
    ("POST", "/api/uploads/plan"): {"files": [{"name": "song.flac", "size": 10}]},
    ("GET", "/api/uploads"): None,
    ("GET", "/api/uploads/{session_id}"): None,
    ("POST", "/api/uploads/{session_id}/parts"): {"part_numbers": [1]},
    ("POST", "/api/uploads/{session_id}/complete"): None,
    ("DELETE", "/api/uploads/{session_id}"): None,
    ("GET", "/api/assets"): None,
    ("GET", "/api/assets/{asset_id}"): None,
    ("DELETE", "/api/assets/{asset_id}"): None,
    ("GET", "/api/assets/{asset_id}/playback-url"): None,
    ("POST", "/api/assets/{asset_id}/playback-proxy"): None,
    ("GET", "/api/assets/{asset_id}/playback-proxy"): None,
    ("POST", "/api/storage/derived-playback-url"): None,  # body built per test: Alice's key
    # Hosted processing (cloud.hosted_render): each names the caller's workspace first, and
    # `test_hosted_processing_never_reaches_another_accounts_songs` checks the songs themselves.
    ("GET", "/api/hosted/songs"): None,
    ("POST", "/api/hosted/songs/prepare"): {},
    ("POST", "/api/hosted/songs/{asset_id}/retry"): None,
    ("POST", "/api/hosted/mixes/plan"): {"count": 4},
    ("POST", "/api/hosted/mixes/render"): {"songs": [{"asset_id": "tenant-a"}]},
    ("POST", "/api/hosted/mixes/export"): {"songs": [{"asset_id": "tenant-a"}]},
    ("GET", "/api/hosted/exports/{job_id}"): None,
    ("POST", "/api/devices"): {"name": "Browser", "kind": "laptop"},
    ("GET", "/api/devices"): None,
    ("PATCH", "/api/devices/{device_id}"): {"name": "Kitchen"},
    ("POST", "/api/devices/{device_id}/sign-out"): None,
    ("GET", "/api/playback/session"): None,
    ("POST", "/api/playback/heartbeat"): {
        "device_id": "missing",
        "song_index": 0,
        "offset_ms": 0,
    },
    ("POST", "/api/playback/take-over"): {"device_id": "missing"},
    ("POST", "/api/playback/reconnect"): {"device_id": "missing"},
    ("POST", "/api/playback/commands"): {
        "device_id": "missing",
        "command": "pause",
        "based_on_seq": 0,
        "fence": 0,
        "idempotency_key": "tenant-matrix",
    },
    ("POST", "/api/playback/commands/{command_id}/ack"): {
        "device_id": "missing",
        "result": "applied",
    },
    # ADR-0475 G3: the sender reads whether the speaker carried out its press
    ("GET", "/api/playback/commands/{command_id}"): None,
    # One device asks another of the same person's devices to start (ADR-0475 R2), held to the
    # same principal as a press (playback/start_asks.py)
    ("POST", "/api/playback/start-asks"): {
        "device_id": "missing",
        "target_device_id": "missing",
    },
    # The default speaker names one of the caller's own devices (ADR-0475), checked against the
    # caller's workspace and user (playback/default_speaker.py)
    ("PUT", "/api/devices/default-speaker"): {"device_id": "missing"},
    ("POST", "/api/playback/start-asks/{ask_id}/answer"): {
        "device_id": "missing",
        "asker_device_id": "missing",
        "result": "declined",
    },
    # Zone playback (venue zones; the same workspace principal as personal playback, so a
    # caller naming another workspace is refused before the zone is looked up).
    ("GET", "/api/zones/playback"): None,
    ("GET", "/api/zones/holding"): None,
    ("GET", "/api/zones/{zone_id}/playback/session"): None,
    ("POST", "/api/zones/{zone_id}/playback/heartbeat"): {
        "device_id": "missing",
        "song_index": 0,
        "offset_ms": 0,
    },
    ("POST", "/api/zones/{zone_id}/playback/take-over"): {"device_id": "missing"},
    ("POST", "/api/zones/{zone_id}/playback/reconnect"): {"device_id": "missing"},
    ("POST", "/api/zones/{zone_id}/playback/commands"): {
        "device_id": "missing",
        "command": "pause",
        "based_on_seq": 0,
        "fence": 0,
        "idempotency_key": "tenant-matrix-zone",
    },
    ("POST", "/api/zones/{zone_id}/playback/commands/{command_id}/ack"): {
        "device_id": "missing",
        "result": "applied",
    },
    ("POST", "/api/zones/{zone_id}/playback/hand-back"): {
        "device_id": "missing",
        "song_index": 0,
        "offset_ms": 0,
    },
    ("POST", "/api/rooms"): {"name": "Party", "settings": {}},
    ("GET", "/api/rooms/current"): None,
    ("GET", "/api/rooms/{room_id}"): None,
    ("PATCH", "/api/rooms/{room_id}/settings"): {"votes": False},
    ("POST", "/api/rooms/{room_id}/lock"): None,
    ("POST", "/api/rooms/{room_id}/unlock"): None,
    ("POST", "/api/rooms/{room_id}/code"): {"remove_everyone": False},
    ("POST", "/api/rooms/{room_id}/end"): None,
    ("POST", "/api/rooms/{room_id}/requests/{request_id}/approve"): None,
    ("POST", "/api/rooms/{room_id}/requests/{request_id}/pass"): None,
    # the host's browser reads and resolves accepted room requests (rooms/browser_requests.py)
    # what each of the workspace's devices can open, by song id (ADR-0475, local_media/api.py)
    ("GET", "/api/local-media/holdings"): None,
    ("GET", "/api/room-requests"): None,
    ("POST", "/api/room-requests/{request_id}/played"): None,
    ("POST", "/api/room-requests/{request_id}/dismiss"): None,
    ("POST", "/api/room-requests/{request_id}/waiting"): None,
    ("POST", "/api/rooms/{room_id}/guests/{guest_id}/approve"): None,
    ("POST", "/api/rooms/{room_id}/guests/{guest_id}/remove"): None,
    ("POST", "/api/rooms/{room_id}/guests/{guest_id}/ban"): None,
    ("POST", "/api/rooms/{room_id}/displays"): {"pairing_code": "ABC-123"},
    ("DELETE", "/api/rooms/{room_id}/displays"): None,
    ("DELETE", "/api/rooms/{room_id}/displays/{display_id}"): None,
}
# The scoped routes that name one resource. In his own workspace, Bob asking for Alice's
# resource must get the same answer as asking for one that doesn't exist.
BY_ID = sorted(key for key in SCOPED if "{session_id}" in key[1] or "{asset_id}" in key[1])


class People:
    """Three signed-in tokens: Alice, Bob, and a Bob token about to expire (for event streams)."""

    def __init__(self) -> None:
        def person(name: str, expires_at: float) -> Claims:
            return Claims(
                subject=f"user_{name}",
                issued_at=1_000,
                expires_at=expires_at,
                email=f"{name}@example.test",
                email_verified=True,
            )

        self.claims = {
            ALICE: person("alice", 4_000_000_000),
            BOB: person("bob", 4_000_000_000),
            BOB_BRIEF: person("bob", time.time() + 1.5),
        }

    def verify(self, token: str) -> Claims:
        try:
            return self.claims[token]
        except KeyError:
            raise BadSignature("unknown test token") from None


class Objects:
    """An in-memory object store that remembers every key it was asked about."""

    def __init__(self) -> None:
        self.data: dict[str, bytes] = {}
        self.meta: dict[str, dict[str, str]] = {}
        self.touched: list[str] = []

    def put(self, key: str, content: bytes) -> None:
        self.data[key] = content
        self.meta[key] = {"sha256": hashlib.sha256(content).hexdigest()}

    def create_multipart_upload(self, _bucket, key, **_kwargs):
        self.touched.append(key)
        return "multipart-test"

    def presign_upload_part(self, _bucket, key, _upload_id, part_number, _ttl, **_kwargs):
        self.touched.append(key)
        return f"https://objects.test/{key}/{part_number}"

    def list_parts(self, _bucket, key, _upload_id):
        self.touched.append(key)
        return []

    def abort_multipart_upload(self, _bucket, key, _upload_id):
        self.touched.append(key)

    def head_object(self, _bucket, key):
        self.touched.append(key)
        return ObjectHead(key, len(self.data[key]), "etag", metadata=self.meta[key])

    def presign_get(self, _bucket, key, _ttl, _filename=None):
        self.touched.append(key)
        return f"https://objects.test/{key}?signed"

    def delete_object(self, _bucket, key):
        self.touched.append(key)
        self.data.pop(key, None)


@pytest.fixture
def world(tmp_path, monkeypatch):
    """Alice and Bob signed up; Alice owns an upload, an asset, a derived file and events."""
    objects = Objects()
    for name in ("ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        monkeypatch.setenv(f"SELECTA_R2_{name}", "test")
    monkeypatch.setattr(storage_api, "R2Client", lambda *_args, **_kwargs: objects)
    monkeypatch.setenv("SELECTA_CHECKOUT_CONSENT_VERSION", CONSENT)
    monkeypatch.delenv("SELECTA_STRIPE_SECRET_KEY", raising=False)
    # Zone playback routes ship dark behind `business.zones`; on here, so the matrix proves
    # their workspace checks rather than the flag guard (the conftest resets flags after).
    from selecta import flags

    flags.use("+business.orgs +business.zones")

    engine = make_engine(f"sqlite:///{tmp_path / 'cloud.sqlite'}")
    migrate.upgrade(engine)
    # Hosted media is a staff grant (ADR-0455); granted here so the upload and asset routes
    # reach their workspace checks rather than the flag guard.
    grant_hosted_media(engine)
    app = create_cloud_app(cloud_settings(), engine=engine, verifier=People())
    with TestClient(app) as client:
        workspace = {}
        for token in (ALICE, BOB):
            answer = client.post(
                "/api/onboarding/complete", headers=_auth(token), json={"age_confirmed": True}
            )
            assert answer.status_code == 201, answer.text
            workspace[token] = answer.json()["workspace_id"]
        alice_ws, bob_ws = workspace[ALICE], workspace[BOB]

        planned = client.post(
            "/api/uploads/plan", headers=_auth(ALICE), json=SCOPED[("POST", "/api/uploads/plan")]
        )
        assert planned.status_code == 201, planned.text
        session_id = planned.json()["uploads"][0]["session"]["id"]

        asset_id = new_id()
        song = b"alice's song"
        objects.put(original_key(alice_ws, asset_id), song)
        derived = derived_key(alice_ws, "playback", "a" * 64, new_id(), "proxy.flac")
        objects.put(derived, b"derived audio")
        with transaction(engine, alice_ws) as conn:
            now = db_now(conn)
            conn.execute(
                assets.insert().values(
                    id=asset_id,
                    workspace_id=alice_ws,
                    original_key=original_key(alice_ws, asset_id),
                    size=len(song),
                    sha256=hashlib.sha256(song).hexdigest(),
                    format="flac",
                    duration_s=180.0,
                    sample_rate=44_100,
                    channels=2,
                    created_at=now,
                )
            )
            for owner, topic in ((alice_ws, "alice.secret"), (bob_ws, "bob.own")):
                conn.execute(
                    outbox_events.insert().values(
                        topic=topic, workspace_id=owner, payload={"x": 1}, created_at=now
                    )
                )

        yield {
            "client": client,
            "engine": engine,
            "objects": objects,
            "alice_ws": alice_ws,
            "bob_ws": bob_ws,
            "ids": {
                "session_id": session_id,
                "asset_id": asset_id,
                "flag_id": "lucy",
                "device_id": new_id(),
                "room_id": new_id(),
                "mix_id": new_id(),
                "job_id": new_id(),
                "display_id": new_id(),
                "request_id": new_id(),
                "guest_id": new_id(),
                "command_id": new_id(),
                "ask_id": new_id(),
                "zone_id": new_id(),
                "song_id": 1,
                "conversation": new_id(),
                "revision": new_id(),
                "proposal": new_id(),
                "key": new_id(),
                "message": new_id(),
            },
            "derived": derived,
            "alice_keys": {original_key(alice_ws, asset_id), derived, f"s/{session_id}/object"},
        }
    engine.dispose()


def _auth(token: str, workspace_id: str | None = None) -> dict[str, str]:
    # Origin as the app sends it, so origin checks pass and the workspace check decides.
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": new_id(),
        "Origin": "https://app.test",
    }
    if workspace_id:
        headers["X-Workspace-ID"] = workspace_id
    return headers


def _call(client, method, path, ids, headers, body):
    return client.request(method, path.format(**ids), headers=headers, json=body)


def _body(world, key):
    if key == ("POST", "/api/storage/derived-playback-url"):
        return {"key": world["derived"], "ttl": 60}
    return SCOPED[key]


def _rows_of(engine, workspace_id) -> dict[str, list]:
    """Every row in every tenant table that belongs to this workspace, except the audit log
    (which may rightly record a refused attempt)."""
    found = {}
    with engine.connect() as conn:
        for table in metadata.sorted_tables:
            if "workspace_id" not in table.c or table.name.startswith("audit"):
                continue
            rows = conn.execute(sa.select(table).where(table.c.workspace_id == workspace_id)).all()
            found[table.name] = sorted(map(repr, rows))
    return found


def test_every_cloud_route_is_classified(world):
    routes = {
        (method, route.path)
        for route in world["client"].app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api")
        for method in route.methods - {"HEAD"}
    }
    classified = (
        PUBLIC | CAPABILITY_ONLY | SELF_ONLY | STAFF_ONLY | BUSINESS_SCOPED | FLAG_DARK
        | set(SCOPED)
    )
    assert routes - classified == set(), "new routes must join the tenant isolation matrix"
    assert classified - routes == set(), "the matrix names routes that no longer exist"


def test_alice_can_reach_everything_bob_is_refused(world):
    """The positive control: the fixtures are real, so Bob's refusals mean isolation."""
    client, ids = world["client"], world["ids"]
    assert client.get(f"/api/uploads/{ids['session_id']}", headers=_auth(ALICE)).status_code == 200
    assert client.get(f"/api/assets/{ids['asset_id']}", headers=_auth(ALICE)).status_code == 200
    url = client.get(f"/api/assets/{ids['asset_id']}/playback-url", headers=_auth(ALICE))
    assert url.status_code == 200, url.text
    derived = client.post(
        "/api/storage/derived-playback-url",
        headers=_auth(ALICE),
        json={"key": world["derived"], "ttl": 60},
    )
    assert derived.status_code == 200, derived.text


@pytest.mark.parametrize("route", sorted(SCOPED), ids=" ".join)
def test_naming_another_workspace_is_refused_before_anything_happens(world, route):
    method, path = route
    before = _rows_of(world["engine"], world["alice_ws"])
    world["objects"].touched.clear()

    answer = _call(
        world["client"],
        method,
        path,
        world["ids"],
        _auth(BOB, world["alice_ws"]),
        _body(world, route),
    )

    assert answer.status_code == 404, answer.text
    assert answer.json()["detail"]["code"] == "workspace_not_found"
    assert _rows_of(world["engine"], world["alice_ws"]) == before
    assert world["objects"].touched == []


@pytest.mark.parametrize("route", BY_ID, ids=" ".join)
def test_another_accounts_resource_looks_exactly_like_a_missing_one(world, route):
    method, path = route
    client = world["client"]
    before = _rows_of(world["engine"], world["alice_ws"])
    world["objects"].touched.clear()
    body = _body(world, route)

    theirs = _call(client, method, path, world["ids"], _auth(BOB), body)
    made_up = {name: new_id() for name in world["ids"]}
    missing = _call(client, method, path, made_up, _auth(BOB), body)

    assert theirs.status_code == 404, theirs.text
    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
    assert _rows_of(world["engine"], world["alice_ws"]) == before
    assert not set(world["objects"].touched) & world["alice_keys"]


def test_another_accounts_derived_file_looks_exactly_like_a_missing_one(world):
    client = world["client"]
    theirs = client.post(
        "/api/storage/derived-playback-url",
        headers=_auth(BOB),
        json={"key": world["derived"], "ttl": 60},
    )
    made_up = derived_key(world["alice_ws"], "playback", "b" * 64, new_id(), "proxy.flac")
    missing = client.post(
        "/api/storage/derived-playback-url", headers=_auth(BOB), json={"key": made_up, "ttl": 60}
    )
    assert theirs.status_code == 404
    assert theirs.json() == missing.json()
    assert world["derived"] not in world["objects"].touched


def test_lists_show_only_your_own_things(world):
    client = world["client"]
    uploads = client.get("/api/uploads", headers=_auth(BOB)).json()
    library = client.get("/api/assets", headers=_auth(BOB)).json()
    assert world["ids"]["session_id"] not in repr(uploads)
    assert library["assets"] == []
    alice = client.get("/api/assets", headers=_auth(ALICE)).json()
    assert [item["id"] for item in alice["assets"]] == [world["ids"]["asset_id"]]


def test_the_event_stream_carries_only_your_own_events(world):
    # Start the brief token's clock now: the fixture can take longer than its life on a busy
    # machine, and an already expired stream ends before sending anything.
    people = world["client"].app.state.token_verifier
    people.claims[BOB_BRIEF] = dataclasses.replace(
        people.claims[BOB_BRIEF], expires_at=time.time() + 1.5
    )
    answer = world["client"].get("/api/events", headers=_auth(BOB_BRIEF))
    assert answer.status_code == 200
    assert "bob.own" in answer.text
    assert "alice.secret" not in answer.text


def test_signing_out_everywhere_touches_only_your_own_sessions(world):
    client = world["client"]
    out = client.post("/api/account/sign-out-everywhere", headers=_auth(BOB, world["alice_ws"]))
    assert out.status_code == 200, out.text
    assert client.get("/api/account", headers=_auth(ALICE)).status_code == 200
    assert client.get("/api/account", headers=_auth(BOB)).status_code == 401


def test_deleting_your_account_never_deletes_anyone_elses(world):
    before = _rows_of(world["engine"], world["alice_ws"])
    gone = world["client"].delete("/api/account", headers=_auth(BOB, world["alice_ws"]))
    assert gone.status_code == 202, gone.text
    alice = world["client"].get("/api/account", headers=_auth(ALICE))
    assert alice.status_code == 200
    assert alice.json()["workspace"]["id"] == world["alice_ws"]
    assert _rows_of(world["engine"], world["alice_ws"]) == before


def test_onboarding_twice_never_joins_another_workspace(world):
    again = world["client"].post(
        "/api/onboarding/complete",
        headers=_auth(BOB, world["alice_ws"]),
        json={"age_confirmed": True},
    )
    assert again.status_code in {200, 201}, again.text
    assert again.json()["workspace_id"] == world["bob_ws"]


def test_hosted_processing_never_reaches_another_accounts_songs(world):
    """Bob, in his own workspace, names Alice's song and her job: every hosted route answers as
    it does for made-up ids, queues nothing for her and touches none of her files."""
    from selecta.work.schema import jobs

    client, alice_song = world["client"], world["ids"]["asset_id"]
    made_up = new_id()

    def jobs_of(workspace_id):
        with world["engine"].connect() as conn:
            return conn.execute(
                sa.select(jobs.c.id).where(jobs.c.workspace_id == workspace_id)
            ).all()

    ready = client.post("/api/hosted/songs/prepare", headers=_auth(ALICE), json={})
    assert ready.status_code == 200, ready.text
    assert [song["asset_id"] for song in ready.json()["songs"]] == [alice_song]
    alice_jobs = jobs_of(world["alice_ws"])
    assert alice_jobs, "Alice's own song is queued for analysis (the positive control)"
    before = _rows_of(world["engine"], world["alice_ws"])
    world["objects"].touched.clear()

    listed = client.get("/api/hosted/songs", headers=_auth(BOB)).json()
    assert (listed["songs"], listed["total"]) == ([], 0)
    for path in ("/api/hosted/mixes/render", "/api/hosted/mixes/export"):
        theirs = client.post(path, headers=_auth(BOB), json={"songs": [
            {"asset_id": alice_song}, {"asset_id": alice_song}]})
        missing = client.post(path, headers=_auth(BOB), json={"songs": [
            {"asset_id": made_up}, {"asset_id": made_up}]})
        assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json()), path
    theirs = client.post(f"/api/hosted/songs/{alice_song}/retry", headers=_auth(BOB))
    missing = client.post(f"/api/hosted/songs/{made_up}/retry", headers=_auth(BOB))
    assert theirs.status_code == 404
    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
    planned = client.post("/api/hosted/mixes/plan", headers=_auth(BOB), json={"count": 4})
    assert planned.json() == {"songs": []}
    theirs = client.get(f"/api/hosted/exports/{alice_jobs[0].id}", headers=_auth(BOB))
    missing = client.get(f"/api/hosted/exports/{made_up}", headers=_auth(BOB))
    assert theirs.status_code == 404
    assert theirs.json() == missing.json()
    assert jobs_of(world["bob_ws"]) == []
    assert _rows_of(world["engine"], world["alice_ws"]) == before
    assert not set(world["objects"].touched) & world["alice_keys"]
