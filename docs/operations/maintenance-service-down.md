# Maintenance service down

The maintenance service is `selecta maintain`, run as two copies: one leads and one stands by
(§4.3, `src/selecta/maintain.py`). If neither is running, the API and workers keep serving, but
everything that only happens in the background stops.

## What stops

- **Jobs**: expired leases aren't reaped, so work held by a crashed worker waits; retries that
  fell due stay scheduled; blocked dependents aren't released. Fair-share heads aren't checked.
- **Dangerous actions**: queued actions (an emergency control's release, a broad flag rule, a
  mass override) never run when due. `POST /api/admin/actions/{id}/execute` runs one by hand.
- **Storage**: upload reservations aren't expired, so quota stays held; deletion tombstones
  aren't mirrored or purged; derived data isn't evicted.
- **Billing**: stored Stripe events wait; the daily reconciliation doesn't run.
- **Accounts**: account-deletion steps stop, which can breach the 30-day erasure promise.
- **Other sweeps**: abandoned Lucy turns, ended flag previews, expired rooms and guest data, the
  admin Overview's aggregates (they turn stale, then unknown), and the nightly usage
  reconciliation.

## First checks

1. Are both copies running? The host's dashboard, or their logs (`Maintenance service running:`
   lists the tasks; `Maintenance task ... is off:` names any left out and the setting it needs).
2. Who leads? `SELECT * FROM leader_terms WHERE name = 'maintenance'`: `holder` and
   `renewed_at`. A `renewed_at` more than a few seconds old means no copy is leading.
3. Can they reach PostgreSQL on a direct connection? The leader lock needs one; a
   transaction-mode pooler drops it. Set `SELECTA_MAINTENANCE_DATABASE_URL` to the direct URL.
4. Repeated `Maintenance task <name> failed` lines point at one task; the others keep running.

## Restart

Restart the stopped copy (or both) from the host. It's safe at any time: every task is
idempotent and fenced by the leader's term, so a copy that loses the lock mid-task stops before
it writes anything more, and the new leader starts with a higher term. On deploy the host sends
SIGTERM; the copy stops at the end of its tick and releases the lock, and the standby leads on
its next tick.

## After it's back

Nothing needs replaying by hand: the first ticks catch up on everything due. Watch that
`leader_terms.renewed_at` moves, the Overview's numbers turn fresh, and any action that waited
past its expiry is marked expired (propose it again if it still matters).
