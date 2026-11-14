# Browser Cloud acceptance and release evidence

**Authority:** PR #84, ADR-0485, the browser device capability matrix and the master plan.
This folder supplies *test instructions and evidence schemas*, not replacement architecture.

Selecta Cloud's customer experience must be HTTPS and no-install: customer audio remains on
the playing device. Developer tooling can use Node, Playwright, Python and FFmpeg to test;
**none is a required end-user Cloud audio server or installation**. Native standalone Selecta
continues separately.

## Automated checks

From the repository root (developer workstation):

```sh
cd web
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
node ../tools/browser_test/generate-fixtures.mjs
pnpm exec playwright test -c br64-10.playwright.config.ts
node ../tools/browser_test/summarise.mjs
```

The fixture generator needs FFmpeg **on the test/developer host only** for MP3, AAC,
FLAC and Opus. It generates only owned sine wave/silence/clipping files in the
ignored `web/node_modules/.cache/selecta-browser-qa` directory. No user music is copied.

The independent synthetic fixture HTTP server uses loopback port 5194 and exits when
Playwright finishes. It is deliberately **not** the customer Cloud runtime. Test traces
show actual Web Audio/AudioWorklet callbacks; the output path is digitally muted.
A passing test does not assert that any physical speaker received sound.

Existing `pnpm test`, `pnpm build`, `pnpm e2e`, `pnpm e2e:cloud`,
Python tests and CodeQL remain part of the base CI. New `browser-acceptance`
runs additional Chromium, Firefox and WebKit projects independently.

## Evidence levels

1. **Automated:** decode or AudioWorklet executed in a real browser binary on CI.
2. **Emulated:** desktop engine under phone/tablet viewport and touch emulation.
3. **Manual real hardware:** actual OS, device, foreground/interruptions, measured local output.
4. **Certified venue:** real iPad-only or Android-tablet-only playback for at least six actual
   hours, powered, awake, foreground, with verified speaker and source access.
5. **Release:** all required features, privacy, security, parity and device classes pass;
   owner signs off.

Do not promote one level to another. iPad-simulation WebKit on Linux is not iPadOS Safari;
Chromium's Android profile is not Android Chrome/Samsung Internet/Android Firefox.
Missing hardware evidence is **NO-GO**, not an inferred pass.

See [device matrix](compatibility.md), [hardware protocol](device-certification.md),
[parity](parity.md), [developer diagnostics](developer-guide.md) and
[release checklist](release-gates.md).
