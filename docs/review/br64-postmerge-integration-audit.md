# PR #64 — Browser-first post-merge implementation and safety audit

**Audit scope:** ten recovery PRs #85–#94 merged into `docs/local-first-cloud-rearchitecture-20261113`, plus final integration commits. **Destination:** PR #64, **not main**. **Architectural authority:** merged PR #84, ADR-0485. **Product status:** INTEGRATION COMPLETE AT SOURCE LEVEL; **NOT PRODUCTION CERTIFIED**.

This document distinguishes *implemented and reachable*, *implemented but not physically verified*, and *still incomplete*. A Cloud route responding 200, AudioContext reporting running, synthetic tests, and a browser-only audio graph are **not** proof that a physical speaker is audible.

## Integration gaps repaired after combining the agent branches

| Area | Before integration | Repair in PR #64 | Result |
| --- | --- | --- | --- |
| Cloud shell | `CloudApp` hid actual browser transport when local-first was on, rendering status-only Agent 07 dock | Mount `CloudTransportDock` in local-first and legacy branches, match `local_first.personal`; never use hosted playback proxy on browser-first | Real local player reachable without installer |
| Agent 02 -> Agent 01 media | File-picker catalogue and two-deck player maintained separate files | Player scans imported File objects to `localCatalogue`, offers re-opening already verified locally imported files | Local files can be selected or loaded from Connect Music; permission is checked again |
| Agent 02 -> Agent 07 Studio | Studio had no installed media port | `LiveBrowserIntegration`, `liveBrowserStudioPorts` register on authenticated workspace; local scan, opaque canonical metadata, exact local File binding, full hash recheck | Real missing/media-ready states; no audio egress |
| Agent 07 -> Agent 01 audio | Studio `playHere` port absent, first-play sound-check circular dependency | Real browser playback port, tap-time `AudioContext.resume`, queue and basic cut/crossfade with strict unsupported gates; check physical output **after** start | Local basic playback; per-transition tempo-stretch not certified |
| Agent 05 -> Studio export | Chunked renderer existed but no live UI port | Local `OfflineAudioContext` decode, bounded PCM clip plan, call `renderMixLocally` for validated WAV artifact | Basic WAV exports reachable on capable browser; mobile long-set not qualified |
| Agent 06 Cloud API | Routes unmounted; isolated tables outside global schema; SQL lacked tenant RLS context | Explicit signing-key-gated mount, WorkOS principal and business venue membership, plan entitlement check, shared metadata and Alembic migration with RLS; scoped transactions | Authenticated metadata-only API source wired, rollout flag **off by default** |
| Agent 06 browser transport | Proposed previous `lf-device-control` endpoints incompatible with actual `/api/lf/v1` | Cloud API origin/workspace header fixed; actual signed browser-session panel and executor; queued/accepted/applied statuses, manual on-site sound/silence and fenced transfer UI | Actual per-zone Cloud control is gated and requires real registered foreground players |
| Agent 08 venue | Independent venue Web Audio graph could coexist with the personal/Studio deck | Reuse browser-wide exclusive `BrowserAudioLease`, release on pause/stop/end; fail closed if held elsewhere; stop hidden mobile output | Local same-profile duplicate speaker risk reduced; cross-device partition still needs Cloud fencing |
| Agent 09 storage | Legacy upload/render endpoints and old service surfaces remained present | Agent 09 tombstones and policy preserved; no new hosted-media fallback in Studio or player; deployment remains separately staged | No newly introduced Cloud PCM/audio route, but full hosted-media decommission audit still required |
| Agent 10 QA | Device-specific tests separate and most browser test specimens not run as part of existing E2E | Added targeted Studio, ownership, route/migration and shell tests | Test sources authored, **not an actual executed certification** |

## Applied contracts / user-visible behaviour

- **Browser only:** Standard Cloud local music is selected via `File`/supported directory permissions. Playback and mixing use Web Audio/AudioWorklet; no signed Cloud audio URL, Python installer, FFmpeg binary, service or mandatory PWA.
- **One real output:** Personal player and venue code acquire the same browser-profile Web Locks name, falling back to cooperative storage+BroadcastChannel only where supported. No lock claim about other physical computers or a disconnected zone.
- **Real transport:** Local play/pause/skip/seek/gain/EQ/crossfades are implemented; failure to decode, unsupported browser or missing recording never silently asks Cloud to stream the music.
- **Studio:** A recipe is not playable/renderable unless every exact occurrence has an authorised local file/version. A saved title, alternative master or Cloud metadata alone never verifies the recording. This first integration creates opaque UUID-style local references; it does not yet provide cross-device reattachment UX for those exact master identities.
- **Remote control:** A new registered browser session has a memory-only token and signed command key. Cloud verifies WorkOS identity, workspace/venue role, zone and plan. The browser refuses stale fences and nonlocal recipes; real acknowledgement follows a local action. A takeover needs explicit release/silence confirmation at the old speaker and new speaker output confirmation. A background/suspended iPad is not assumed reachable.
- **Output reality:** `AudioContext.running`, a nonzero PCM frame and a Cloud accepted receipt do not prove speakers emitted sound. A human sound check is recorded distinctly, invalidated by interruptions/restarts/track changes where supported.
- **Metadata/privacy:** No new path submits `File`, PCM, stems, raw hash, source path or reconstructed audio to Cloud. JSON Cloud plans and remote controls use scoped opaque metadata; platform privacy/security/egress review must still verify historical code routes and logs.

## Release blockers — not fixed by combining branches

### P0: must resolve before general availability

1. **Real hardware verification:** iPadOS Safari **and home-screen PWA**, iPhone Safari, Android Chrome/tablet, Windows/macOS/Linux Chrome/Edge/Firefox/Safari where applicable, all with model/OS/browser, decode/latency/output, six-hour foreground venue soak, Bluetooth disconnect, USB/DAC, silent WebKit failure, app switch, power loss and screen lock evidence. No physical-device certifications were performed in this authoring environment.
2. **Remote transfer safety in field:** Test authenticated sessions across *real separate phones/tablets/computers*, blackholed connections, expiries, replays and non-atomic fallback. Full registered browser executor cannot guarantee prompt delivery while OS backgrounded; operator must always retain an on-site stop/recovery procedure.
3. **Cloud API rollout gates:** Set and rotate a strong 32+ byte `SELECTA_BROWSER_CONTROL_SIGNING_KEY` (hex) via secrets manager, apply `br6406ctrl01` migration, validate forced PostgreSQL RLS and real WorkOS token path, enable `local_first.browser_control` flag explicitly, test staff role/zone restrictions, protect proxy HTTPS headers. Do not set test actor headers in production.
4. **Full end-to-end business scheduling and Rooms:** Agent 08's manual browser venue player now shares output ownership, but durable programme scheduling, guest request approval -> exact local prepared track -> verified play lifecycle and multi-venue staff control still need a verified integration. Never say unattended venue automation is complete.
5. **Legacy hosted-audio retirement & migration:** Agent 09 tombstones legacy routes and disables worker deployment but does not migrate/erase backups, historical asset references or provisioned R2 objects, and production Stripe v2 price/secret mappings need an independently reviewed rollout; avoid destructive operations in this PR.
6. **Music-rights, tenant/egress/privacy and browser accessibility audits** remain external acceptance gates. Do not infer lawful venue playback from file-picker permission alone.

### P1: production feature gaps, explicitly degraded

7. **Memory/long songs:** Agent 01 baseline uses bounded whole-file decode (96 MiB compressed file, 128 MiB decoded PCM) and a two-buffer cache; Agent 05 Studio integration additionally caps total loaded PCM at 128 MiB. Long mobile sets require streamed/windowed decode, source resampling/cache budgets, quantifiable thermals and interruption checkpoints.
8. **DSP quality parity:** Agent 03 modules have tests and prepared seams, but the live Studio is deliberately wired only to cuts/uniform crossfades; true beatmatch, time-stretch, limiter parity, phase alignment, multi-transition timeline and golden musical quality remain unqualified.
9. **Neural portability:** Agent 04 registers and gates model candidates but does not ship browser-qualified Beat This, S-KEY, Demucs/HTDemucs or wav2vec2 checkpoints. Licence, model-conversion, low-RAM/WASM/WebGPU and real-device parity gates remain open; no fake stems/word cuts.
10. **Browser export:** Base chunked WAV/FLAC engines exist, but the integrated Studio adapter emits only WAV, not a user-selected FLAC. Live preview/transitions and full large-mix FLAC encoding/rendering require source bindings, decoding-window lifecycle and hardware validation.
11. **Cross-device recipe media reattachment:** The Studio keeps opaque canonical metadata and device-local file revision IDs. A second device must independently verify and rebind its exact recording versions, with conflict/alternative-master prompts; it cannot access source Files from the first browser. This UX is not finished.
12. **Browser test harness:** Agent10's `br64-10.playwright.config.ts` currently matches only `br64-10-*.spec.ts`; many other agent specs require a dedicated Vite test runner and stable fixture route. Do not say all cross-agent scenarios execute in CI without an updated runner.

## Verification status — factual

- All ten recovery PRs were merged by GitHub with HEAD-locked merges into **PR #64 working branch only**, no merge into main.
- Final integration code and tests were committed through the authenticated GitHub connection. File contents, PR metadata and module contracts were inspected via GitHub. Some unit and migration logic has been reviewed statically.
- **Local build/test execution: NOT VERIFIED.** The environment cannot resolve `github.com` to clone the repository. Newly authored tests are not claimed passing; workflow runs triggered by every commit may be queued/cancelled. The owner requested CI not gate the integration, but that is not a claim of green build or production readiness.
- **Actual device output, multi-machine session, browser test, PostgreSQL migration and production deployment: NOT EXECUTED.**
- **Security review:** design-level checks only; formal exploitation testing, branch-level CodeQL triage, browser CSP/security headers, storage quota and historical egress evidence remain required before release.

## Suggested smoke commands (for repository operators)

```bash
cd web
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm exec playwright test -c br64-10.playwright.config.ts

# from repo root; run against disposable fixtures/database, not production
uv run pytest tests/test_br64_final_integration.py tests/test_br64_06_browser_control.py tests/test_br64_08_browser_session.py -q
```

The Playwright command above checks Agent 10's lab harness only; run additional agent-specific specs under a purpose-built Vite configuration. No real-device pass can be inferred.

## Disposition

**Source integration:** merged and repaired inside PR #64.  
**Release status:** **NO-GO** for claiming a fully portable, unattended, premium-parity Cloud/venue DJ product. Basic supported browser-local playback and a limited Studio/WAV path have a genuine implementation; all unverified features must remain correctly gated/degraded.  
**Merge to main:** intentionally **not performed**.


## Follow-up source audit — browser safety, obsolete UI and export recovery (2026-11-14)

The owner requested an additional implementation audit and removal of unused code on **this same PR #64 branch**, without using CI failures as the work queue. These changes are code-level fixes and regression tests, **not execution evidence** or device certification.

### Fixes committed

1. **Venue start/stop and skip races:** venue programme transitions now serialize and carry invalidation epochs; late source preparation cannot silently restart a stopped venue, double-Start is rejected, and interrupted sessions require a fresh on-device Start instead of an unsafe Resume. The audio adapter rejects stale async starts/transitions and File replacement with the same recording ID.
2. **Decoded PCM memory:** browser venue preparation deduplicates in-flight decodes and counts their resources against an aggregate PCM budget. Stale decoder completions cannot turn a stopped player back into a Ready state.
3. **Browser control fencing:** browser speaker generation is restored from writable persistent local storage and persisted **before** acknowledging newly audible ownership, not only release. The browser fails closed if the fence cannot be persisted, and does not claim a failed remote skip/pause was applied. Mobile/tablet capability hints no longer always say desktop.
4. **Personal audio graph:** Studio queue replacement preserves an AudioContext unlocked in a genuine user click, preventing a second unprompted Safari gesture requirement. Old queue decodes cannot contaminate replacement media with an identical recording ID; a rapid third-track skip stops a previously fading source before reusing that deck.
5. **Mixing sound quality:** the AudioWorklet no longer hard-clips crossfade samples to ±1 **before** the existing compressor/master. The downstream stage controls peaks; premature clipping had irreversibly distorted overlaps.
6. **Export recovery:** a damaged generated render-cache WAV/FLAC is discarded and rebuilt after verification fails. Orphan cache markers and partial files are removed without touching original local recordings, other artifacts or user-saved exports.
7. **Studio recipe truthfulness:** live playback now rejects nonzero source-second cues that its simple two-deck player would ignore, plus missing or misordered transition sequences. Basic rendering can continue using its separate cue-aware pipeline; unsupported live DJ parity is not misrepresented.
8. **Dead-code removal:** removed the disconnected LF10 native-engine-oriented `PersonalWorkspace.tsx`, its retired test, its private React state hooks and obsolete `personal.css`. The actual browser-first `BrowserWorkspace.tsx` used by Uploads/Library and the legacy standalone/development folder-watch code remain intact.

Regression cases were added for the relevant audio, venue, Studio, persistent-fence and cache scenarios. This report does **not** assert that Vitest, browser CI, real iPad/Android hardware, output measurement, Cloud migrations or full integration tests were run.

### Remaining cautions

- **Release remains NO-GO for general unattended venue operation** until real iPadOS/Android interruption, Bluetooth, six-hour continuous output, zone-policy and remote takeover hardware trials are passed.
- The bounded whole-file decoder and baseline Studio transport still do **not** provide mobile long-mix streaming, complete beatmatch/stem/neural parity or fully cue-accurate live performance. Do not claim those features are complete.
- The legacy unflagged Cloud Uploads/Listen screens remain routed for compatibility even though old hosted-audio endpoints return authenticated HTTP 410. Before user-facing rollout, resolve the feature flag/default path and retire misleading legacy purchase/upload copy deliberately, without deleting the separate standalone local product.
- Final integration still needs dependency/build, security, browser regression, route migration and physical-device testing. User asked not to prioritise CI failures during this specific source audit; that is not a waiver for production release.

