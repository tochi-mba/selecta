# LF browser-native Cloud release gates — including Android and iPad venue qualification

**ADR-0485 (2026-11-14) supersedes all mandatory installed Cloud engine/venue PC assumptions.** Physical testing on a sole Android tablet **and** sole iPad is compulsory for supported tablet venue claims.

**Current status:** Browser Cloud capability unverified; earlier PR #64 Python LF work cannot substitute for browser hardware evidence. The 136 LF tasks must be audited individually. No commercial or pilot launch is authorised by this PR.

## Hard NO-GO gates

| Gate | Proof required | Decision owner |
|---|---|---|
| LF-G01 Existing functionality | Source-to-user feature parity, including local DSP, editor, stem studio, export, rooms, Autopilot, accessible UI | Engineering + product |
| LF-G02 Forbidden hosted audio | Endpoint scan, cloud/network egress captures, logs/AI/storage/backups, no active hosted renderer | Security + privacy |
| LF-G03 Portable recipes | Two-device 5/8-media fixture, wrong master, duplicate occurrence, version invalidation, history restore | Local engine + UX |
| LF-G04 Playback safety | Authenticated browser sessions, phone-to-tablet preflight, double owner/partition, stale command and browser termination drill | Playback |
| LF-G05 Venue reliability | Six-hour **foreground/awake** powered iPad and Android tablet speaker tests, Wi-Fi loss, OS/background/lock and safe manual recovery; multi-zone only when verified | Venue + operator |
| LF-G06 Rights | UK public performance vs copying and provisioning, stem/export and model distribution licensing in target territory | Qualified counsel |
| LF-G07 Billing and account | Current paid plan treatment, Stripe and AI usage, account export/delete, safe historical migration | Billing + privacy |
| LF-G08 Legacy media exit | Data inventory, retrieval, notices, backups/retention, migration and restore after sunset | Data owner |
| LF-G09 Source security | Browser session origin and HTTPS/WSS security, credential revocation, scoped command and RLS; localhost only for separate native mode | Security |
| LF-G10 Observability | Real source/output/device status, stale/unknown condition and no sensitive telemetry | Operations |
| LF-G11 Accessibility | 320 px, keyboard, screen reader, 400% zoom, reduced motion, full personal/business states | UX accessibility |
| LF-G12 Infrastructure | Modal/gateway/audio R2 and signing secrets decommissioned only when replacement proves parity | Platform |
| LF-G13 CI and audit | Complete 136-task evidence, browser feature flags, Chromium/Firefox/Safari/Android matrix, no cloud media, rollback and physical tests | Independent reviewer |

## Rollback checkpoints

1. **Metadata-only docs:** This PR does not change running services, so normal Git revert is sufficient.
2. **Pre-cutover new local agents:** Roll back client/flag and metadata API schema while preserving original files and recipe revisions.
3. **Post-legacy admission shutdown:** Old retrieval may remain temporarily where contractually approved, but never reopen uncontrolled new audio uploads.
4. **Pre-R2 purge:** Restore compatible metadata/control services only after data integrity and security checks; preserve lawful customer retrieval.
5. **Post-R2 purge:** Irreversible by design. Never promise a full audio restore or reintroduce remote audio processing in a code rollback.

## Pilot versus commercial launch

Pilot gate includes functioning hardware, per-venue licences/copy rights, privacy controls, operator monitoring and real offline playback, even if billing is disabled. Paid launch additionally needs commercial rights and terms, customer support capability, validated plan benefits, UK billing/tax process and approved service commitments. TheMusicLicence alone is not a blanket copying/export right.

## Sign-off template

| Field | Required |
|---|---|
| Baseline head commit | SHA |
| Complete LF checklist | No checked item without source/test evidence |
| Media egress/rights review | Signed document and scope/territory |
| Parity failures remaining | Zero critical, justified and approved noncritical only |
| Real device and venue soak | Hardware/OS/output details and recorded gaps |
| Migration and rollback | Restore IDs, object counts and recovery outcome |
| Independent reviewer | Different from implementer |
| GO / NO-GO | Dated unambiguous decision |

Any major false-ready speaker, copyrighted audio cloud egress, unsafe double audio, missing legacy recipe, lost local original, content-policy bypass or unapproved media purge is a hard NO-GO.

## Mandatory browser-first gates added by ADR-0485

| Gate | No-go until |
|---|---|
| LF-G14 Browser audio | Real JS/WASM/AudioWorklet engine renders and plays from local file without Python, FFmpeg install, native service or second computer |
| LF-G15 iPad-only venue | iPad Safari and Home Screen site on a fresh device serve real output for six hours awake/foreground; handling of lock, silence and power documented |
| LF-G16 Android-only venue | Chrome Android **and** qualified Samsung Internet/Firefox states, OEM battery/Doze/audio focus, source picker, USB/BT/HDMI and six-hour real-output test |
| LF-G17 Musical DSP portability | Every advertised technique and neural model has actual browser parity/per-device benchmarks or an explicit unsupported state; no remote protected audio fallback |
| LF-G18 Browser lifecycle | Storage eviction, tab discard, wake lock loss, user gesture, phone call, sound route, Cast constraints, crash and reboot recovery are honestly communicated |
| LF-G19 Accessibility/privacy | iPad VoiceOver, Android TalkBack and desktop keyboards, sound checks, metadata-only network capture and legal/model licences verified |

**NO-GO:** reporting iPad/Android PWA as guaranteed unattended 24/7, hiding a native mandatory install, deeming Web Audio analyser peaks physical audibility, or shipping a reduced-quality algorithm as exact parity.
