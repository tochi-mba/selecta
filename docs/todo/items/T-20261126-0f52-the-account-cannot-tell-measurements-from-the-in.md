---
id: T-20261126-0f52
title: The account cannot tell measurements from the interim beat source
area: storage
status: done
priority: high
who: claude
created: 2026-11-26
source: docs/engineering/device-to-account.md
commit: 20d530c6
---

The browser stores its measurements under web-dsp-1+web-onset-comb-beats-1 (the interim beat source, 4/4 only) but the account's allowlist (engine_store/facts.py DEVICE_IMPLEMENTATIONS) accepts only web-dsp-1, so factsWire.ts sends web-dsp-1 and the account cannot tell interim-beat measurements from ones made with Beat This in the browser; device-analysis.md says the facts carry the beat source's id, which is not true on the wire. When Beat This lands in the browser its measurements rank equal and replace by time only. Good: a device implementation id that names the beat source (for example web-dsp-1+web-onset-comb-beats-1 in the allowlist and RANK below a neural one), sent by factsWire.ts.

2026-11-26: The upload names the beat source (web-dsp-1+web-onset-comb-beats-1 or web-dsp-1+web-beatthis-small0-1); facts.py allows both beside plain web-dsp-1 and ranks Beat This above the interim source, below the Python analysis (0d10a14e, 20d530c6).
