# ADR-0483 - Behaviour at the limit and truthful words

- **Decision:** Accepted (owner, 2026-11-25).
- **Programme:** Lucy Usage (LM).
- **Implementation:** Not started. The step-down chain and the built-in planner exist (`_cheaper_route` in `src/selecta/ai/gateway.py`, `builtin_words` in `src/selecta/lucy/cloud_agent.py`); the per-cause words and the session step do not.
- **Source touchpoints:** `src/selecta/ai/gateway.py`, `src/selecta/lucy/cloud_agent.py`, `src/selecta/lucy/cloud_prompt.py`, `web/src/lucy/reducer.ts`, `web/src/cloud/Billing.tsx`.

## Context

At the baseline a turn that cannot run on the plan's model steps down silently: class, then model, then the built-in planner. The person is told one thing, "You've used this month's Lucy turns", for both the allowance and the dollar ceiling. Nothing offers a next step. Gemini moves a subscriber to its smallest model at the cap; Claude asks them to wait or spend credits.

## Decision

1. **Session limit reached, week has room.** Lucy keeps answering on the next model down the chain for the rest of the session: Premium on Sonnet, Standard on Haiku. Free, already on Haiku, goes to the built-in planner. Lighter turns are charged their real cost to the weekly limit.
2. **Weekly limit reached.** The built-in planner answers until the weekly reset. It still searches the library, and Make a Mix still works.
3. **One message per cause, each true.** The reason recorded on the run (`limited`) picks the words. Each names the cause, the time it ends in the account's time zone, and what still works:

   | Cause | Lucy says, in substance |
   |---|---|
   | Session limit, lighter model answering | She is answering with a lighter Lucy until the session time, then returns to normal. Said once per session, not on every reply. |
   | Session limit, no lighter model (Free) | This session's Lucy use is spent; it comes back at the session time. |
   | Weekly limit | This week's Lucy use is spent; it comes back on the weekly day and time. |
   | Platform cap | Lucy's AI is very busy; this did not use any of their allowance. |
   | Provider unreachable | Lucy's AI cannot be reached; this did not use any of their allowance. |
   | Per-turn cap | She stopped because one message can only do so much work; the reply so far stands. |

4. **Times.** A time today is shown as a clock time ("16:40"); a later day as weekday and time ("Thursday 09:00"). Both come from the same function the meter uses (ADR-0484), so the two can never disagree.
5. **Level, not model.** Following ADR-0476 edge case 35, the words say "a lighter Lucy", never a model name. The run still records the deployment for support.
6. **One next step, offered once.** At the session or weekly limit the page shows, under Lucy's words, the choices that apply: wait until the stated time; see plans, if a higher plan exists; use extra usage, if ADR-0486 is switched on and the person has opted in. It is shown once per limit event and never interrupts a reply that is still arriving.
7. **Nothing is lost.** The conversation stays readable and the person's unsent words stay in the box. A turn refused for a limit counts nothing.
8. The silent mid-turn retry on a provider failure stays silent, as now. Only a step-down caused by the person's own limit is announced.
9. Plan cards drop "a very heavy month moves to a lighter model" for wording that matches rule 1.

## Consequences

- A paying member is never left with nothing inside a week unless the week itself is spent.
- Lucy admits to answering with a lighter model, which ADR-0476 edge case 7 kept silent. That rule was written for the hidden ceiling; with a visible limit, silence would be the misleading choice.
- Lucy's words and the meter take their reset time from one function, so they cannot disagree.

## Rejected alternatives

- **Hard stop at the session limit.** Clean, but a member mid-party is cut off for hours while they still have most of their week.
- **Step down without saying so.** Cheaper to build and what happens today; it makes a worse answer look like Lucy's best.
- **Queue the turn until the reset.** A mix request answered five hours later is not what was asked for.

## Acceptance

The [Lucy Usage checklist](selecta-lucy-usage-implementation-checklist.md) LM-0483 items define implementation and verification.
