# LF exhaustive edge-case and negative-behaviour catalogue

**Status:** Accepted contract, tests not implemented. Each scenario must map to a test ID in [verification matrix](selecta-local-first-verification-matrix.md), not remain only prose.

## Media discovery and source health

| ID | Trigger | Required behavior |
|---|---|---|
| LF-E01 | External drive removed during playback | Continue current buffered audio if possible; re-evaluate upcoming; never claim whole recipe Ready |
| LF-E02 | Drive letter/path renamed | Preserve binding identity; offer local relink, no cloud path exposure |
| LF-E03 | Same path now contains different bytes | Invalidate analysis, cues, seams and cache; no stale play |
| LF-E04 | Partial copy or decoder bomb | Quarantine parse locally; reject ready state and isolate parser process |
| LF-E05 | Symlink/path traversal/cyclic tree | Scan safely; no arbitrary external path trust |
| LF-E06 | Identical title, live/remaster/radio edit | Candidate only until verified; no automatic cue reuse |
| LF-E07 | Clean master missing but explicit exists | No auto-substitution under clean-only policy |
| LF-E08 | ISRC collision or tag inconsistency | User/manual verification and distinct canonical reference |
| LF-E09 | Same track twice in mix | Distinct occurrence IDs, independent positions and seams |
| LF-E10 | Filesystem permission revoked | User reauthorises locally, not server-upload workaround |
| LF-E11 | Unsupported codec/device | Honest Unsupported; keep recipe editable |
| LF-E12 | Very large library / duplicate folders | Paged bounded scan, incremental watcher, cancellation, no unlimited RAM |
| LF-E13 | Network share unavailable | Mark source-disconnected; prevent hanging decoder |
| LF-E14 | Disk fills mid-export | Atomic abort, cleanup, preserve source and earlier exports |
| LF-E15 | Cache corruption/model version change | Checksum failure -> local rebuild with proper deadline |

## Recipe and synchronization

| ID | Trigger | Required behavior |
|---|---|---|
| LF-E16 | Recipe opened on music-less phone | Metadata/edit mode; explicit Control existing player / no local Play |
| LF-E17 | 5/8 required recordings available | Preflight reports 5/8, missing/revision reasons, repair actions, original unchanged |
| LF-E18 | Source changed while loading preview | Reject stale async result and rebuild |
| LF-E19 | Two offline editors reorder concurrently | Conflict UI, preserve both revisions |
| LF-E20 | One editor renames and another adds unrelated tag | Safe disjoint merge if schema supports it |
| LF-E21 | Revision restored but media missing | Restore recipe definition; report locally unplayable |
| LF-E22 | Recipe references deleted cloud legacy asset | Preserve unresolved ref; offer relink |
| LF-E23 | Policy/version updated during currently playing seam | Respect committed window with defined safety override |
| LF-E24 | Alternate recording is shorter | Cue invalidation and no stale seam |
| LF-E25 | Engine upgrade changes render format | Versioned compatibility and targeted rebuild |
| LF-E26 | Cloud lost while local edit pending | Durable local outbox; no lost changes |

## Multi-device audio / control

| ID | Trigger | Required behavior |
|---|---|---|
| LF-E27 | Two simultaneous Play Here commands | One fenced owner, idempotent ACK |
| LF-E28 | Destination missing current track | Preflight fails, original keeps playing |
| LF-E29 | Destination lacks future tracks | Show readiness/fallback policy before takeover |
| LF-E30 | Source offline while audible, new takeover requested | Refuse unsafe takeover until isolation/fencing verified |
| LF-E31 | Old speaker stops, new crashes | Deterministic recovery, no double audio |
| LF-E32 | Cloud heartbeat stale but source still running | Mark authority uncertain; no false cutover |
| LF-E33 | Duplicate/out-of-order/late Skip | Ignore stale generations/expired commands |
| LF-E34 | User switches personal/business workspace | Correct authority; no cross-workspace media |
| LF-E35 | Paused local player loses cloud | Pause locally; no unexpected Play after reconnection |
| LF-E36 | Bluetooth output disconnects | Safe route/fallback, bounded volume and actual output alert |
| LF-E37 | Browser tab closes but venue agent running | Audio service keeps running if configured |
| LF-E38 | Local agent update during venue hours | Defer or explicitly controlled urgent mitigation |

## Venue scheduling and rights

| ID | Trigger | Required behavior |
|---|---|---|
| LF-E39 | Midnight-spanning opening | Correct previous-day opening window and close |
| LF-E40 | DST skipped/repeated hour | No duplicate/absent open/close event |
| LF-E41 | Venue clock wrong | Trusted time uncertainty policy; explicit alert |
| LF-E42 | Internet down six hours | Local authorised scheduled/fallback music continues |
| LF-E43 | Main music drive absent at opening | Approved local fallback or clear no-play alert |
| LF-E44 | Guest requests song absent at zone | Request refused/pending, never claimed scheduled |
| LF-E45 | New explicit filter removes next track | Enforce hard policy before next play |
| LF-E46 | Manager edits programme mid-set | New version applies at safe musical boundary |
| LF-E47 | Two zones share one exclusive output | Reject unsafe mapping or configure explicit shared zone |
| LF-E48 | CPU/stems overload on shared host | Protect every active audio output, preempt background work |
| LF-E49 | 20 venues receive programme; 3 cannot resolve audio | HQ shows per-venue N/M readiness and blocks unready activation |
| LF-E50 | Rights/pilot/payment grace expires while offline | Apply locally cached approved permit, never mid-service surprise without defined policy |
| LF-E51 | License recorded but copying rights absent | Do not assume reproduction/performance rights identical |
| LF-E52 | Kiosk reports AudioContext unlocked but no real sound | Health stays uncertain/silent; operator alert |
| LF-E53 | Venue loses power, reboot during closing period | Re-evaluate actual hours, policy and device ownership before auto resume |
| LF-E54 | Offline play logs reconnect twice | Exactly-once effects via IDs, privacy and appropriate retention |

## Security, cost and migration

| ID | Trigger | Required behavior |
|---|---|---|
| LF-E55 | Audio embedded as base64/JSON or crash report | Prohibited by schema and cloud egress tests |
| LF-E56 | Remote command includes local filesystem path | Reject; local trusted binding only |
| LF-E57 | Cross-tenant guessed device/room ID | Deny without identity leakage |
| LF-E58 | Lost/stolen paired device | Revoke tokens and cloud scope; explain physical local media risk |
| LF-E59 | Plan downgrade during active local render | Never block local DSP for old server CPU/storage cap |
| LF-E60 | R2 backup restored after sunset | Does not reactivate upload/stream capability; retention handling verified |
| LF-E61 | Existing paid cloud user had hosted audio | Retrieval and contract notice before purge |
| LF-E62 | Subscription webhook duplicate/out of order | Versioned entitlement reconciliation |
| LF-E63 | Standalone local user never signs in | No cloud or telemetry requirement |
| LF-E64 | Model weights under non-commercial licence | Release gated despite client-side execution |
| LF-E65 | Broken metadata sync from 1,000 devices | Backoff/jitter, bounded outbox and truthful freshness |

## Review protocol

Every row needs named happy/failure tests, source owner, expected telemetry, screen text, migration consideration and independent evidence. A release cannot downgrade critical missing-media, playback partition, copying rights or privacy cases to unverified assumptions.
