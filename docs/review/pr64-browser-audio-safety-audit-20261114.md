# PR #64 — Browser audio safety and dead-code audit (2026-11-14)

**Target:** PR #64 `docs/local-first-cloud-rearchitecture-20261113` (one open integration PR).  
**Starting code HEAD audited:** `11fa5e30516164c011c66c2d15ff46ba643e8664`.  
**Scope:** focused browser sound/venue ownership, mobile wake/interruptions, source readiness, local render/cache, and hosted-audio boundary review; **not** an exhaustive assurance of 548 changed files.  
**Execution:** fixes committed directly to the existing branch; **no CI or physical device results are claimed**.

## Fixed implementation bugs

| Area | Defect | Resolution |
|---|---|---|
| `web/src/engine/ownership.ts` | A delayed Web Locks grant could recreate ownership after Stop/dispose; concurrent acquire could race | Generation-fenced grants and shared pending acquisition, fail-closed after cancellation |
| `web/src/venue-player/browserAudio.ts` | Venue Start could launch after Stop while waiting for exclusive speaker lock | Recheck epoch after lock acquisition; stale callbacks no longer release newer owner's lock |
| Same | AudioContext unlock could finish after Stop and misreport Ready; paused unlock could report Playing | Fence asynchronous unlock; preserve paused state |
| Same | Wake Lock request could finish after Stop, keeping an idle tablet screen awake | Release late sentinels; request wake only on active Start/Resume, not when merely unlocked |
| Same | Sound-check tone could outlive Stop or begin after a cancelled lock request | Track and silence test oscillator; fence delayed sound check |
| Same | Rapid venue transitions could leave a third song playing; Stop missed outgoing fades | Track and end the outgoing source on rapid Skip and Stop |
| `web/src/venue-player/programme.ts` | Stopped/suspended AudioContext remained reported as active; recurring tick could survive interruption | Mark interrupted and halt programme timer |
| Same | Cloud health always reported local source ready after initial connection | Re-check actual source state and report false on disconnection or check error |
| `web/src/engine/BrowserAudioRuntime.ts` | Redundant no-op MediaSession seek handler | Removed dead handler; register actual seek action explicitly |
| `src/selecta/storage/api.py` | Unused egress guard import after upload retirement | Removed unused import while retaining explicit 410 API compatibility |

## Regression tests added

- Late Web Lock grant after Stop and after disposal.
- Cancelled venue Start and sound check during delayed browser lock acquisition.
- AudioContext unlock and Wake Lock permission finishing after Stop.
- Stop actually silencing an active sound test and both sides of a crossfade.
- Rapid repeated venue Skip not allowing three concurrent audio sources.
- AudioContext paused/interrupted while venue still appears foreground.
- Music source disconnect reported as `sourceReady: false`.

Tests were authored; full Vitest/Playwright/CI was **not executed** in this connector-based audit. Real iOS/Android speaker tests remain necessary.

## Cleanup decisions

- Keep `src/selecta/api.py` / Python DSP: they are part of the **independent standalone mode** and remain the musical reference for browser ports.
- `src/selecta/storage/api.py` explicitly rejects hosted audio upload with HTTP 410; the legacy upload/UI modules still have imports and route compatibility consumers. Do **not** delete them wholesale without a verified route/import migration and protected-data inventory.
- `src/selecta/routes/cloud_proxy.py` retains explicit HTTP 410 behavior. Deleting it now would remove an intentional denial contract and can change client semantics.
- Original local recordings, browser source bindings, OPFS generated exports and metadata were not deleted by this audit. No infrastructure teardown occurred.

## Remaining limitations — not falsely marked fixed

1. Browser players still decode entire source files into RAM with per-file/PCM caps; long songs and low-memory devices need a genuinely streaming window decoder.
2. Some advanced Python Beat This/Demucs/wav2vec2/FP DSP quality features remain conditional or unported on particular browsers. Do not claim full mobile neural parity.
3. Browser venue playback requires supervised, foreground and awake operation. Wake Lock, PWA installation and an active AudioContext do not guarantee physical audibility or reboot continuation.
4. The old hosted-audio UI code is still present behind compatibility flags. A separate verified dependency/route retirement step is needed before removing complete modules.
5. Independent multi-device soak, Android Doze/audio focus/physical speakers, Safari interruption, rights/privacy reviews and end-to-end browser certification remain release gates.

**Next safe gate:** run the added focused browser tests and manual sound tests on actual iPads and Android tablets, then integrate only after outstanding release risks have been evaluated. CI-only failures were intentionally not investigated per owner instruction.
