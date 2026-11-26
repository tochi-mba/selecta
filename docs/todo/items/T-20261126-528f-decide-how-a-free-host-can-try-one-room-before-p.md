---
id: T-20261126-528f
title: Decide how a Free host can try one Room before paying
area: rooms
status: open
priority: high
who: owner
created: 2026-11-26
source: docs/research/worth-paying-for.md
commit:
---

Today a Free account sees Rooms only as a locked card (RoomsCard in web/src/cloud/CloudApp.tsx). Rooms are the clearest reason to buy Premium, and nobody can feel one before paying. Parties happen a few times a year, so a 7-day trial clock often runs out before the party.

Decision needed from the owner, one of: (a) a reverse trial counted in events, for example the first room on Premium free with no card; (b) a one-off party pass, for example about £4.99 for 48 hours of Premium, sold the way Lucy packs already are (Stripe payment mode, docs/saas/08-billing.md); (c) keep Rooms locked. Research: reverse trials and per-event pricing in party apps, worth-paying-for.md sections 4 and 5. Claude builds whichever is chosen.
