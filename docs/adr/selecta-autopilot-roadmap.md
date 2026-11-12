# Selecta Autopilot and UX integration roadmap

**2026-11-12:** 24 Proposed ADRs (0417-0440), 120 Not started tasks, zero independently verified. Documentation only, no feature removals or runtime edits.

## Mission

Selecta remains the intelligent, personal music DJ with full local editing, Library, Studio, lyrics, Lucy, Inspector, requests, exported mixes and visualizers. Cloud continues providing accounts, private uploads, billing, devices, staff console and QR Rooms. The proposed extension is **a genuine unattended resident DJ for an entire venue evening**, not simply crossfading playlists. It plans a musical arc and rolling song horizon, makes conservative meaningful transitions, accepts moderated requests, takes simple staff steering and safely sustains audio despite model and network failures.

## Delivery phases

1. **Protect what exists:** ADR-0417 and 0434. Snapshot actual existing flows and qualify the music/model commercial rights.
2. **Close core experience gaps:** 0418-0423. Deliver real Cloud mixing, persistent single Cloud player, canonical navigation, truthful Library/upload states, nickname confirmation and clear mix-creation scope.
3. **Build autonomy:** 0424-0428. Night session lifecycle, venue rules, time-of-night arc, rolling horizon, transition fallback, deterministic AI control boundary.
4. **Make it operational:** 0429-0436. Six-hour playback, staff console, requests, learning, speaker classes/zones, privacy, security and alerts.
5. **Demonstrate product-market fit:** 0437-0439. Real device/audio soak, uncoached venue staff and guest testing, legal pilots, blind listening and accessibility.
6. **Gate the release:** 0440. Exact-SHA evidence, approved rights and independent signed GO/NO-GO for new commercial Autopilot only.

## Decisions

| ADR | Decision | Checklist |
|---|---|---|
| [417](adr-417-preservation-charter-and-compatibility.md) | Preservation charter and compatibility | 5 Not started |
| [418](adr-418-cloud-intelligent-mixing-parity.md) | Cloud intelligent mixing parity | 5 Not started |
| [419](adr-419-cloud-single-audio-owner.md) | Cloud single audio owner | 5 Not started |
| [420](adr-420-cloud-route-and-account-state-ux.md) | Cloud route and account-state UX | 5 Not started |
| [421](adr-421-truthful-library-and-upload-states.md) | Truthful Library and upload states | 5 Not started |
| [422](adr-422-guest-nickname-and-room-state-consistency.md) | Guest nickname and Room state consistency | 5 Not started |
| [423](adr-423-make-a-mix-language-and-settings-scope.md) | Make a Mix language and settings scope | 5 Not started |
| [424](adr-424-autopilot-resident-dj-charter.md) | Autopilot resident DJ charter | 5 Not started |
| [425](adr-425-venue-music-identity-and-schedules.md) | Venue music identity and schedules | 5 Not started |
| [426](adr-426-rolling-musical-horizon.md) | Rolling musical horizon | 5 Not started |
| [427](adr-427-conservative-transitions-and-failover.md) | Conservative transitions and failover | 5 Not started |
| [428](adr-428-bounded-ai-dj-director.md) | Bounded AI DJ director | 5 Not started |
| [429](adr-429-six-hour-venue-audio-continuity.md) | Six-hour venue audio continuity | 5 Not started |
| [430](adr-430-one-glance-staff-dashboard.md) | One-glance staff dashboard | 5 Not started |
| [431](adr-431-autopilot-moderated-requests.md) | Autopilot moderated requests | 5 Not started |
| [432](adr-432-venue-learning-and-privacy-safe-memory.md) | Venue learning and privacy-safe memory | 5 Not started |
| [433](adr-433-venue-speakers-leases-and-zones.md) | Venue speakers, leases and zones | 5 Not started |
| [434](adr-434-venue-music-and-model-rights-clearance.md) | Venue music and model rights clearance | 5 Not started |
| [435](adr-435-role-security-guest-privacy-and-safe-sound.md) | Role security, guest privacy and safe sound | 5 Not started |
| [436](adr-436-operational-observability-and-recovery.md) | Operational observability and recovery | 5 Not started |
| [437](adr-437-performance-and-long-session-evidence.md) | Performance and long-session evidence | 5 Not started |
| [438](adr-438-venue-market-and-pilot-validation.md) | Venue market and pilot validation | 5 Not started |
| [439](adr-439-responsive-inclusive-ui-across-modes.md) | Responsive inclusive UI across modes | 5 Not started |
| [440](adr-440-phased-rollout-and-independent-go-no-go.md) | Phased rollout and independent GO NO-GO | 5 Not started |

[Master checklist](selecta-autopilot-implementation-checklist.md) · [Feature preservation](selecta-autopilot-feature-parity.md) · [Evidence](selecta-autopilot-implementation-evidence.md) · [Release gates](selecta-autopilot-release-gates.md)
