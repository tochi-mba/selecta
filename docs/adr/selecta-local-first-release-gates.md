# LF release gates, rollback and independent go/no-go

**Accepted direction:** 2026-11-13. **Current status:** Design only; 0 LF acceptance tasks implemented and 0 independently verified. No commercial or pilot launch is authorised by this PR.

## Hard NO-GO gates

| Gate | Proof required | Decision owner |
|---|---|---|
| LF-G01 Existing functionality | Source-to-user feature parity, including local DSP, editor, stem studio, export, rooms, Autopilot, accessible UI | Engineering + product |
| LF-G02 Forbidden hosted audio | Endpoint scan, cloud/network egress captures, logs/AI/storage/backups, no active hosted renderer | Security + privacy |
| LF-G03 Portable recipes | Two-device 5/8-media fixture, wrong master, duplicate occurrence, version invalidation, history restore | Local engine + UX |
| LF-G04 Playback safety | Paired device authentication, preflight, double owner/partition, stale command and old-speaker crash drill | Playback |
| LF-G05 Venue reliability | Offline six-hour service, restart/power cut, real audio output, multi-zone scheduling and content policy | Venue + operator |
| LF-G06 Rights | UK public performance vs copying and provisioning, stem/export and model distribution licensing in target territory | Qualified counsel |
| LF-G07 Billing and account | Current paid plan treatment, Stripe and AI usage, account export/delete, safe historical migration | Billing + privacy |
| LF-G08 Legacy media exit | Data inventory, retrieval, notices, backups/retention, migration and restore after sunset | Data owner |
| LF-G09 Source security | Localhost and origin protection, pairing credential revocation, scoped commands and RLS | Security |
| LF-G10 Observability | Real source/output/device status, stale/unknown condition and no sensitive telemetry | Operations |
| LF-G11 Accessibility | 320 px, keyboard, screen reader, 400% zoom, reduced motion, full personal/business states | UX accessibility |
| LF-G12 Infrastructure | Modal/gateway/audio R2 and signing secrets decommissioned only when replacement proves parity | Platform |
| LF-G13 CI and audit | Complete task evidence, flag ownership, route matrix, migration dry run, rollback, CodeQL and hardware tests | Independent reviewer |

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
