# ADR-0406 - Lyrics in cloud mode

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 2/4 Implemented; 0/4 In progress; 2/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 0. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0390 (`lyrics.lookup`, `listen.lyrics`, `discover.word_links` flags); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/lyrics/lrclib.py`; `src/selecta/lyrics/align.py`; `src/selecta/lyrics/match.py`; `web/src/views/Now.tsx`; `web/src/views/Links.tsx`.
- **Proposal chapter:** [docs/saas/10-audio-engine-in-cloud.md](../saas/10-audio-engine-in-cloud.md#105-lyrics-in-cloud-mode-needs-a-decision).

## Context and evidence boundary

Each song triggers an LRCLIB lookup, and synced lyrics feed wordplay moves, alignment, word connections and the Listen page's lyric display. In a paid cloud product, one service calling LRCLIB for every user's library raises rate-limit and terms questions, and displaying lyrics normally needs a licence.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Cloud lyric lookups go through one globally rate-limited queue, after written confirmation of acceptable use from LRCLIB's operators.
- Lyric display (`listen.lyrics`, stage mode, quoted lines in word connections) is off in cloud mode unless a lyrics licence is obtained.
- Lyrics may still drive analysis features internally if legal advice confirms that use.
- The decision is revisited after legal advice in Phase 0; the flags make either outcome a configuration change.

## User outcome and acceptance contract

Cloud users still get word-aware transitions where allowed, without Selecta displaying lyrics it has no right to show.

## Rejected alternatives

- Calling LRCLIB per user without limits.
- Displaying lyrics commercially without a licence.

## Implementation checklist - 2/4 Implemented; 0/4 independently Verified

1. **SC-0406-01 - Operator contact.** **Acceptance:** LRCLIB's operators have confirmed or refused the intended use in writing. **Required verification:** Correspondence on file. **Implementation:** Not started; Needs a person: written confirmation or refusal from LRCLIB's operators of the intended Cloud use and rate, filed with the correspondence. **Independently Verified:** No.
2. **SC-0406-02 - Global rate limit.** **Acceptance:** Cloud lookups never exceed the agreed rate across all users. **Required verification:** Load test. **Implementation:** Implemented; every Cloud lookup takes a token from one database-backed bucket shared by all processes; local mode never touches it; several processes hammering the bucket together on PostgreSQL never exceed the agreed rate. **Evidence:** `tests/test_cloud_lyrics_rate_limit.py`, including `test_many_processes_together_never_exceed_the_global_rate` (PostgreSQL, Cloud CI job); SQLite tests passing locally on 2026-11-10. **Independently Verified:** No.
3. **SC-0406-03 - Display gating.** **Acceptance:** Lyric display flags default off in cloud mode; pages reflow. **Required verification:** Flag sweep in cloud mode. **Implementation:** Implemented; with no rules, Cloud decides `lyrics.display`, `listen.lyrics`, `listen.word_focus`, `listen.stage` and `discover.word_links` off for Free and Premium (lookups stay on), and every Cloud page reflows around them. **Evidence:** `web/e2e-cloud/flags.cloud.ts` 'with the cloud defaults, lyric display is off and every page closes up around it' and `tests/test_cloud_lyric_display.py`, passing. **Independently Verified:** No.
4. **SC-0406-04 - Legal decision recorded.** **Acceptance:** Internal-use and display questions answered and this ADR updated. **Required verification:** ADR update. **Implementation:** Not started; Needs a person: legal advice on internal lyric use and display, then this ADR updated with the decision; the flags already make either outcome a configuration change (SC-0406-03). **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
