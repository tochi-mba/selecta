# Selecta - independent NO-GO release gates for proposed GP work

**Current verdict (2026-11-12): GP ADRs Accepted and 111 of 128 tasks Implemented, but 17 Not started (each needs a person) and none independently Verified; NO-GO for this new enhancement programme until the gates below are met. This is not a verdict that the existing application is unsafe.**

**2026-11-12 status (recounted from the task lines of the [checklist](selecta-gap-polish-implementation-checklist.md)):** 16 Accepted ADRs (0248-0263, owner accepted 2026-11-08); 128 GP tasks: 111 Implemented, 0 In progress, 17 Not started (each names a person-only step); **0 independently Verified**.

**Historical 2026-11-08 planning baseline:** **16 Proposed ADRs (0248–0263), 128 new GP tasks Not started, 0 In progress, 0 Implemented and 0 independently Verified.** Planning baseline main `2956bc47fd735339e7216e03d27817fb3a31e92b` on 2026-11-08. Owner decisions remain pending. This PR changes only documentation; it neither implements code nor changes historical SF/CI/MI or earlier statuses.

| Gate | Required proof | Current |
|---|---|---|
| Owner and baseline | Explicit acceptance/rejection for each GP ADR and exact implementation SHA | Pending |
| Typography and Listen | Real title corpus, accessible controls and stable player with music | Pending |
| Create and inspector | Exact song/seam selection and live audition without mis-target | Pending |
| Music retrieval | Ranked recorded corpus, 20k latency, no wrong recording | Pending |
| Local collection and backups | Collision, transactions, original files untouched, safe restore/rollback | Pending |
| Device interruptions | Physical headphone/Bluetooth/USB/sleep with manual Pause authority | Pending |
| Returning sessions/help/comfort | Independent first-time and long-session task outcomes | Pending |
| Explore, Discovery, Studio, Requests | Truthful results, proper audio focus, 8-lane parity and bridge consent | Pending |
| Workspace privacy | Detected fault guidance and reviewed redacted support summary | Pending |
| Accessibility/performance | Keyboard, NVDA, 400% zoom, forced-colors, reduced motion and hardware budget | Pending |
| Regression | Green relevant tests on exact implementing SHA | Pending |
| Independent acceptance | Named reviewer/date/device/media and signed GO/NO-GO; rollback proof | Pending |

Reject changes that degrade audio/data safety or accessibility even when visually attractive. A screenshot candidate or muted CI does not prove real sonic/ergonomic acceptance.
