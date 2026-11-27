---
id: T-20261126-e5dd
title: Let a visitor hear SelectaDJ blend two of their own songs before signing up
area: branding
status: open
priority: high
who: claude
created: 2026-11-26
source: docs/research/worth-paying-for.md
commit:
---

The landing page (web/src/cloud/Welcome.tsx) has a drawn blend, three benefits and three steps, but no sound, so nobody can hear what SelectaDJ does before making an account. The research (worth-paying-for.md, sections 2 and 4) says the first session is the sale, that letting people use a product before signing up lost no paying customers in ChartMogul's data, and that the audio pattern to copy is LANDR's free preview of your own track.

Good looks like: a 'Blend two of your songs' action on the landing page. The visitor picks two files, SelectaDJ analyses and blends them in the browser, nothing is uploaded, no account is needed, and the blend plays with a short line saying why it worked (key, tempo, phrase). Full sets, Lucy and Rooms then need an account. First check that the browser engine (web/src/engine, web/src/dsp) can analyse and render a seam with no signed-in session.

Fallback if that is not possible: a 20-second demo with an A/B switch between a plain crossfade and the SelectaDJ blend. That needs the owner to supply tracks we have the rights to publish. Never autoplay sound. Needs its own SELECTA_FLAGS flag; with it off the page is as now.
