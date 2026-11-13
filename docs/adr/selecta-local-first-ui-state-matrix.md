# LF full UI/UX state and route contract

**Status:** Accepted design, not built. **Owners:** ADR-0476,0477,0478. Existing UI, accessibility, visual language and creative controls remain parity requirements. Avoid an app-wide hardware dashboard: device truth must be compact, contextual and actionable.

## Connected personal information architecture

| Journey / route | Current assumption | Replacement and required behaviour |
|---|---|---|
| Welcome and sign-in `CloudApp.tsx` | "Your music, ready to move", private cloud storage | "Your music stays on your device; sync plans, not recordings." Sign in remains optional for standalone |
| Onboarding | 10 GB workspace + upload audio | Choose this computer/remote player/controller-only; install/pair engine; grant folders; output test; privacy/sync choice |
| Home | GB meter, upload card and current plan | Selected device, playing elsewhere, library readiness, recent mixes and action to resume/setup; no artificial DSP quotas |
| Explore | Suggestions assumed to have cloud asset | Suggestions explicitly bound to selected device; show preview availability and missing media |
| My Mixes | A cloud revision exists so it appears runnable | Recipe exists everywhere; per-device N/M exact/verified, candidate/blocked/missing, revision, ready transitions and repair |
| Library | Cloud `assets`, upload tray, storage quota | Local sources, browse/search/corrections, device selector, scans, disconnected drives, variants, local disk diagnostics |
| Studio and seam inspector | Can render/preview from any cloud asset | Editing available without media; preview/render disabled accurately when device has no audio; preserve every current manual edit and undo |
| Stem Studio | Cloud processing allowance for preview | Local capability/model rights/memory status, safe progress and local artifact; never count paid stem previews |
| Listen and transport dock | Signed playback URL and cloud proxy poll | Explicit speaker and output; local/remote control; prepared horizon; failure recovery; no cloud stream |
| Devices | "Play here" moves music | Preflight required exact recordings/output, prepare/stop/ack/fence/start; unsafe partition case requires operator resolution |
| Requests/Rooms | Request any cloud library asset | Request only locally eligible catalogue; requested is not scheduled; guest no audio |
| Plan & billing | 10/50/100 GB, renders, analysis | Feature value, devices, rooms, Lucy, support, venues/zones/seats; hosted AI usage only |
| Account export/delete | Cloud ZIP with originals | Cloud metadata ZIP; separate local archive/cache controls; original files unaffected |
| Settings | Global cloud location assumptions | Selected local sources, output, model/download rights, engine updates, privacy/metadata sync, device diagnostics |

## Readiness states in UI

| State | Exact meaning | Primary user action | Must not claim |
|---|---|---|---|
| `ready` | Target agent verified exact media, renderer and output recently | Play or edit | That other devices are ready |
| `needs_analysis` | Local file is accessible, prerequisites incomplete | Prepare locally / play conservative fallback if allowed | "Cloud render running" |
| `candidate_match` | Possible alternate recording, not verified | Review match, audition local sample where lawful | Exact recording |
| `missing` | No eligible file bound to requested ID | Locate local file, control another speaker | Deleted recipe |
| `source_disconnected` | Known folder/drive inaccessible | Reconnect drive and revalidate | Files lost forever |
| `permission_required` | File access denied or expired | Authorise local folder | Cloud access fix |
| `unsupported` | Codec/model/output unsupported | Explain format/hardware support | Ready after waiting |
| `version_mismatch` | Different master/radio/clean/revision than expected | Review substitution, invalidate cues | Compatible seam |
| `policy_blocked` | Venue/rights hard rule refuses recording | Pick authorised alternative | Flexible rule under pressure |
| `engine_offline` | Local process not communicating | Start/reconnect engine, optionally control another player | Cloud broken necessarily |
| `device_unknown` | No timely availability verification | Refresh/check device | Missing or ready |
| `cache_invalid` | Render checksum/input version stale | Rebuild locally | Reusable transition |
| `cloud_offline` | Control service unreachable | Local music keeps playing; remote management unavailable | Music stopped |
| `output_silent` | Output measurements indicate scheduled audio missing | Staff alert, safe recovery | Player Ready despite heartbeat |

## Missing media interaction

Open mix always shows recipe, arrangement, cues and version history. Device selection triggers preflight. When 5 of 8 recordings are ready, show five verified, two missing, one possible alternative; show exact rows, last-check time, source/rights reasons, and actions:
1. Control the computer that has all eight tracks (remote control only, no stream).
2. Reconnect music drive or grant local folder permission.
3. Locate files locally and verify exact media; never send local path to cloud.
4. Review an alternate master; require clear distinction between equivalent song and render-safe seam.
5. Create a temporary playable variation with a new ID or save edited revision, retaining original unchanged.
6. When relevant, permit explicitly approved venue fallback under content rules, but never automatic unsafe clean->explicit replacement.

A mix can be editable, not auditionable, and not playable. UI and screen readers must distinguish all four.

## Business surfaces

| Surface | Owner needs | Guest/customer sees |
|---|---|---|
| HQ grid | Per-venue N/M recording readiness, zones, sources, output, fallback, engine version, freshness | Never shown |
| Venue onboarding | Lawful source provisioning, licence attestation, physical output test, offline drill, schedule readiness | Not shown |
| Manager | File/drive health, missing music repair, scheduled programme, play-log sync, updates and risk | Not shown |
| Staff | Now Playing, Skip, Bigger/Calmer, Requests and bounded Volume; calm direct recovery | Only functional music controls |
| Kiosk | True local engine state, audio outputs, zone/playlist, emergency unlock | No manager fields or secrets |
| Guest QR room | Only requestable local eligible song metadata, request lifecycle | No music files, URLs or path |

## Responsive and inclusive behavior

- Retain tab/rail/command palette and shortcuts; no controls disappear only due to viewport width.
- At 320px/400% zoom, device selector collapses while keeping playback owner explicit.
- Keyboard selection, focus return after missing-media modal, undo/redo, screen reader announcements and reduced motion work throughout.
- Show plain text status, not color alone. Never display a spinner forever if engine is missing.
- Display last verified time for remote readiness and stale/unknown state, not a falsely reassuring green dot.
- Preserve both light/dark themes, target sizes, guest privacy, route continuity and all existing automated visual baselines.

## Acceptance fixtures

- Personal: computer fully ready; laptop missing 3/8; phone controller-only; machine with disconnected external drive; cloud-only outage; paused offline editing; two active tabs.
- Business: 20-venue HQ with 17 ready; multi-zone output failure; licensing expired; staff phone emergency speaker; blackout restore; customer kiosk with no manager data.
- Test routes/feature flags against each state under screen-reader, keyboard, touch, 320/375/768/1280 widths and high zoom.
