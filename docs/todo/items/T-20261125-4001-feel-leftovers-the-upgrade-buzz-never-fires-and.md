---
id: T-20261125-4001
title: Feel leftovers: the upgrade buzz never fires, and a row glow can replay after motion is turned back on
area: shell
status: done
priority: later
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit: 54579e03
---

(1) web/src/cloud/Billing.tsx:381-390 calls success() in an effect after the return from Stripe; haptics.ts:31-33 needs navigator.userActivation.isActive, which is false after a redirect, so the promised buzz never happens. Drop the call or run it from the next press. (2) feel-flash is removed only on animationend (views/feelLocal.tsx:91,101; views/feelPieces.tsx:199; business/feelBits.ts:78). If motion turns to Still or low power mid-glow, the selector stops matching, no animationend fires, the class stays, and the row glows unprompted when motion comes back. Remove the class on a timer fallback or on feel change. (3) Billing.tsx useUpgradeMoment and cloud/checkout.ts:80 treat any non-free plan as confirmed, so reopening an old ?checkout=success address from history on a paid account celebrates again with nothing changed; compare against the plan held before checkout.
