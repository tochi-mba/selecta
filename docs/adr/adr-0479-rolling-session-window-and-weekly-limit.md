# ADR-0479 - Rolling session window and weekly limit

- **Decision:** Proposed (Claude for the owner, 2026-11-25).
- **Programme:** Lucy Usage (LM).
- **Implementation:** Not started. `src/selecta/ai/allowance.py` has calendar-month keys only (`month_key`, `month_resets_at`); `src/selecta/usage/allowances.py` has day and month periods only.
- **Source touchpoints:** `src/selecta/ai/allowance.py`, `src/selecta/ai/gateway.py`, `src/selecta/ai/spend.py`, `src/selecta/business/entitlements.py`, `src/selecta/usage/allowances.py`.

## Context

A calendar month is a long time to be locked out. A member who spends the allowance on the 4th has no Lucy model until the 1st, and a member who joins on the 28th gets a full month's allowance for three days. A month also lets one account spend its whole budget in an afternoon, which is the case the platform's own daily cap exists to survive. Claude and Gemini pair a five-hour window that starts at the first message with a weekly limit; ChatGPT does the same for its coding agent.

## Decision

1. The Lucy allowance of ADR-0478 is held in two windows, and a turn needs room in both:
   - a **session window** of five hours;
   - a **weekly limit**.
2. **Session window.** It opens when a turn is admitted and no session is open, and closes exactly five hours later whether or not it was used up. There is no sliding average and no fixed daily reset. The next turn after it closes opens a new one.
3. **Weekly limit.** It resets at a fixed weekday and time assigned to the workspace: the weekday and local hour the workspace was created, in the account's time zone. The assignment does not move when the time zone or plan changes; the next reset is recomputed in the new zone.
4. **Starting sizes (hypotheses, set by ADR-0484).** The weekly limit is the plan's present monthly ceiling times 12 and divided by 52, so a year of full use costs what it costs today: about $0.058, $0.82 and $1.52 a week for Free, Standard and Premium. One session may use up to a quarter of the weekly limit.
5. **Plan changes.** An upgrade applies the larger limits to the open session and week at once; what was already used stays used. A downgrade applies at the next weekly reset, in step with ADR-0476 edge case 6.
6. **Clock rules.** All window arithmetic uses the database clock (`db_now`), never the device's. A turn belongs to the session and week in which it was admitted, even if it settles after either has closed.
7. **Business venues.** A venue's pooled allowance (ADR-0448) moves to usage units and a weekly limit with the venue's own reset. It has no session window: a venue runs unattended for a whole trading day and a five-hour lockout mid-service would be a fault, not a fair-use control. The gateway keeps checking the venue pool first.
8. **Unused allowance does not carry over** between sessions or between weeks.
9. The monthly dollar ceiling in `TIER_LIMITS` stays in code as a backstop above the weekly limit until ADR-0484's release gate removes the need for it.

## Consequences

- Nobody is locked out for more than a week, and a heavy afternoon costs a quarter of the week rather than the month.
- Resets spread across every hour of the week, so there is no first-of-the-month surge on the provider.
- A person can be told two different times ("back at 16:40", "back on Thursday"). ADR-0480 and ADR-0481 say which is shown when.
- A year has 52 weeks and a few days; the 12/52 conversion is very slightly generous. ADR-0484 measures it.

## Rejected alternatives

- **Weekly limit only.** Simpler, but one session could spend the whole week, and the provider-side burst is unchanged.
- **Daily allowance.** Resets at local midnight bunch load and punish a person planning one long party set on a Saturday.
- **A true sliding five-hour window.** Usage would trickle back minute by minute and no single reset time could be shown.
- **Keep the calendar month and add a session window.** Keeps the long lockout and the join-date unfairness.

## Acceptance

The [Lucy Usage checklist](selecta-lucy-usage-implementation-checklist.md) LM-0479 items define implementation and verification.
