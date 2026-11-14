# Browser-first Cloud UX across personal, Studio, Android/iPad venues and kiosk

**ADR-0485 (2026-11-14):** Android tablets **and** iPads are first-class no-install venue players. A dedicated computer/native engine is not required. [Research matrix](../adr/selecta-browser-device-capability-matrix.md).

**Accepted:** 2026-11-13. **Not implemented.** Current upload and cloud-storage UI is historical. See [full UI state matrix](../adr/selecta-local-first-ui-state-matrix.md).

## Universal mental model

Where is the music? Which device is actually audible? Can that device play this exact mix? What survives if cloud connectivity disappears? The connected UI must answer all four without exposing complex engine details unnecessarily.

## Personal navigation and first run

Recommended connected destinations: Home, Explore, My Mixes, Library, Studio, Devices, Settings/Billing. Rooms, Lucy, requests and saved history remain reachable contextually, not deleted. Preserve existing local routes, deep links, keyboard interactions and responsive behavior.

New onboarding: Play Here in This Browser / Control Another Player / Edit Without Music; select authorised local audio or folders with device-supported picker, check codec/DSP/storage, tap Start to unlock browser audio, sound-test speaker, optionally sync metadata. **No Install Engine prerequisite.** No 10GB allocation or multipart upload step.

## Library and music sources

Replace Add/Upload tracks with Add local music or Connect music source. Show device selector, folder/drive health, indexing, analysis, cache and local disk. A disconnected drive is not an empty library. Deleting a Selecta index or cache entry must never default to deleting the user's original recording.

## Mix cards and repair

Saved recipe cards show version, selected speaker, count verified out of total, missing or alternate recordings, transition readiness and freshness timestamp. Opening arrangement is always possible. A mix with 5/8 tracks available shows all three unresolved entries and offers Control original speaker, Locate local file, Review alternate, Make temporary variation and Save new version. Never silently replace radio/clean/master with another version or overwrite history.

## Studio, seams and exports

Distinguish editable, renderable, auditionable and playable. When audio is missing show metadata and a truthful placeholder, not fake waveform. Preserve timeline, manual cue, seam inspector, stem studio, undo, request bridges, drafts, history, blind studies and locally validated FLAC exports. Show local resource/model limitations as hardware readiness, not subscription allowance.

## Player and devices

Make Play here, Control Studio PC and Change output distinct. Cloud controller-only phone cannot play local music without its own authorised source. Persistent player displays speaker and output, local readiness, requested vs applied state and correct remote takeover errors. No cloud FLAC URLs, proxy polling or fake buffered track.

## Billing, account and privacy

Plan cards sell feature benefits and hosted AI allowance, not server music storage and CPU/render quota. Local disk/cache appears under Devices. Cloud account export contains metadata and recipes, while local music/exports stay on authorised device. Account deletion does not erase originals.

## Venue and customer UX

HQ shows per-venue local source, N/M programme readiness, audio output, prepared horizon, fallback runway, engine health and freshness. Business setup supports an iPad **or Android tablet alone** as the speaker, imports locally licensed audio, checks Web Audio and physical output, recommends power/awake/foreground and tests six-hour real venue service. Explain that ordinary browsers cannot guarantee unattended background playback or reboot auto-resume.

Staff controls retain Now, Skip, Bigger/Calmer, Requests and safe volume; detailed disk/model diagnostics only for manager. Customer kiosk and QR remain calm and contain no manager/billing/licence details, raw local file paths or audio URLs. AudioContext unlocked is not equivalent to real sound.

## Inclusive and truthful states

Cover browser DSP unavailable, no local source, iPad/Android app suspended or terminated, Android audio focus/Doze, cloud unavailable while foreground browser plays, local source permission revoked, candidate/missing/blocked/version-mismatch recording, unsupported codec, output silent, stale telemetry, recipe conflict, unsafe takeover, payment/rights grace and venue closing. Validate keyboard and screen reader, focus, status wording, 320px, 400% zoom, light/dark and reduced motion.

**Related:** [ADR-0476](../adr/adr-0476-personal-cloud-ux-and-device-aware-information-architecture.md) · [ADR-0477](../adr/adr-0477-missing-media-repair-studio-and-transition-editor-ux.md) · [ADR-0478](../adr/adr-0478-business-hq-staff-and-kiosk-ux-migration.md).

## Device-level adaptive experience

Do not permanently label phones 'controller only'. Any qualified mobile browser can be a player with local authorised music, while controller-only is an actual state. Desktop usually has the highest DSP budget. iPadOS Safari and Android Chrome/Samsung Internet/Firefox use different folder pickers, output routes and model capabilities. Provide exact reasons for `unsupported_here`, `permission_lost`, `foreground_required`, `output_unverified`, `model_too_heavy` and `stale_remote_player`; never promise every phone can run stem separation or unattended venue duty.

A sole venue tablet first-run must be completable entirely on that tablet; a second phone is optional for staff control. Use a visible audio stop/pause button, foreground/wake prompts and a physical sound test. Media Session controls do not prove a complex Web Audio graph will continue under screen lock. Support Touch/VoiceOver/TalkBack, landscape tablets, thermal and low-battery warnings, speaker disconnect and offline service while the browser stays running.
