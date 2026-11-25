# ADR-0484 - One truthful Lucy usage meter

- **Decision:** Proposed (Claude for the owner, 2026-11-25).
- **Programme:** Lucy Usage (LM).
- **Implementation:** Not started. Two meters exist (`LucyTurnsMeter` in `web/src/views/LucyCloudSettings.tsx` and the Lucy line in `web/src/cloud/Meters.tsx`); both read `lucy_turn.*` counters through `src/selecta/usage/meters.py`, which the gateway does not write.
- **Source touchpoints:** `src/selecta/usage/meters.py`, `src/selecta/lucy/cloud_settings.py`, `src/selecta/ai/allowance.py`, `web/src/views/LucyCloudSettings.tsx`, `web/src/cloud/Meters.tsx`, `web/src/cloud/Billing.tsx`.

## Context

The meter and the limit are fed from different tables (ADR-0480 fault 1). Where the meter does have numbers it adds the classes together ("120 of 440"), hides the dollar ceiling and gives no sign that a lighter model answered. `ai.allowance.remaining()` reads the enforced table and is never called. ADR-0402 requires plain meters and rejects showing tokens or CPU seconds.

## Decision

1. There is **one read model** for Lucy usage, computed from the allowance ledger of ADR-0481 by the same module that admits turns. Every surface uses it: Lucy's settings, Plan and billing, the workspace stream, Lucy's own prompt and the admin account view. No surface computes usage for itself.
2. The read model returns, for the session and for the week: the share used as a whole percentage, the reset time, and a state (`ok`, `near` from 80%, `spent`). It also returns whether a lighter Lucy is answering now.
3. **What a person sees: what is left.** Every surface states the share **left**, not the share used ("5-hour: 100% left", "Weekly: 90% left"), because that is the question a person is asking. Lucy's settings and Plan and billing show two lines, "This session" and "This week", each a bar with the percentage left and a reset time in plain words ("back at 16:40", "back Thursday 09:00"). When no session is open the session line reads as full. Free, Standard and Premium see the same layout.
4. **What a person never sees.** Tokens, dollars, usage units, model names or a turn count. This keeps ADR-0402's rule; a share of an allowance is a plain meter, not a token meter.
5. **Rounding is honest.** The percentage left is rounded so it never flatters: 100% left only when nothing has been used, 0% left only when the state is `spent`, and otherwise between 1% and 99%.
6. **The meter can move after a reply.** A turn is reserved at admission and charged at settlement (ADR-0481), so the bar may drop back a little when a reply finishes. The reserved part is drawn as used; no separate "pending" figure is shown.
7. **Live on every device.** The read model is sent on the workspace stream as `lucy.usage` whenever a turn is admitted, settles or a window resets, replacing `lucy.turns`. This closes the "not built" note in ADR-0476 edge case 31.
8. **An estimate is allowed, labelled.** The settings page may add "about N more messages like your recent ones", worked out from the person's own median settled cost over their last 20 turns, always with "about" and never in Lucy's words. It is hidden until 5 turns have settled.
9. **Lucy tells the truth about herself.** Her prompt is given the read model's state and reset times, not allowance numbers, so she can answer "how much have I got left?" in the same words as the page.
10. Venue pools (ADR-0448) use the same read model with the week line only.
11. **A usage ring, always in reach (owner, 2026-11-25).** The owner asked for a compact indicator in the spirit of the small ring ChatGPT shows beside its chat list, whose hover reads "5-hour: 100% left" and "Weekly: 90% left". SelectaDJ takes the idea, not the artwork:
    - A small ring sits in the Lucy page's side rail, near the new-conversation control, wherever Lucy is open. Its arc is the share left of whichever window is closer to running out, so the ring always shows the limit that will bite first.
    - Hover, keyboard focus or a tap opens a small label with both lines, "5-hour: N% left" and "Weekly: N% left", each with its reset time. On a touch device a tap opens it and a second tap, or a tap elsewhere, closes it.
    - Selecting the label's link opens the full meter in Lucy's settings. The ring itself never opens a purchase or a plan page.
    - The ring is quiet at `ok`, takes the warning treatment at `near` and the spent treatment at `spent`, using the existing theme tokens and a shape or mark as well as colour. It does not animate except for one short change when a window resets or a state changes, and not at all under reduced motion.
    - It is drawn with SelectaDJ's own tokens and icon set (ADR-0468); it is not a copy of another product's glyph.
    - With the flag off, or on a plan with no Lucy model, the ring is not shown.

## Consequences

- The disconnected `lucy_turn.*` counters and the unused `ai.allowance.remaining()` are removed once the flag is fully on (ADR-0487).
- A customer can no longer be told "400 turns". Marketing and plan cards describe plans by relative size (ADR-0485).
- Support needs the units behind a percentage; the admin account view shows them.

## Rejected alternatives

- **Repair the turn meter only.** Fixes fault 1 and leaves the second, hidden limit unshown.
- **Show remaining messages as the main figure.** Any count is a guess once cost varies by turn; a guess as the headline would be the new untruth.
- **Copy another product's ring exactly.** The pattern is common and free to use; the drawing is theirs and SelectaDJ has its own design system.
- **Show usage in pounds.** Clear, but it turns a music product into a bill and exposes model prices.

## Acceptance

The [Lucy Usage checklist](selecta-lucy-usage-implementation-checklist.md) LM-0484 items define implementation and verification.
