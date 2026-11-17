# Per-physical-device evidence record template (BF-0466-02)

Every hardware gate in the [gate register](bf-gate-register.md) produces one record per physical
device from this template, saved in this folder as
`bf-evidence-<gate>-<device-slug>-<yyyy-mm-dd>.md` (for example
`bf-evidence-gate6-ipad-a2602-2027-01-15.md`). A record is the unit of evidence: the register's
rows link records, never summaries of memories.

No worked example exists yet, deliberately: fabricating one would break the register's own law
that unknown stays unknown. The first real device run fills the first record, and that record is
BF-0466-02's required verification.

## The template

Copy everything between the rules into a new file and fill every field. Write "unknown" rather
than leaving a field blank or guessing; an unknown field keeps the verdict at NO-GO.

---

```markdown
# Evidence record: <gate number and name> on <device model>

- **Gate:** <register row number and name>
- **Protocol followed:** <link to the written protocol or script, with its version or commit>

## Device tuple

- **Device model:** <exact model and identifier, e.g. iPad (9th gen) A2602, Galaxy Tab A9 SM-X110>
- **OS build:** <exact OS version and build number, e.g. iPadOS 26.1 (23B85)>
- **Browser engine and version:** <engine plus full version, e.g. WebKit / Safari 26.1,
  Blink / Chrome 143.0.7483.60>
- **RAM and chipset:** <e.g. 3 GB, A13 Bionic / 4 GB, Helio G99>
- **SelectaDJ engine version:** <the web build's engine version or commit SHA under test>

## Run conditions

- **Source and codec:** <where the audio came from and its format, e.g. local FLAC 44.1 kHz via
  cloud.local_media import; hosted AAC proxy>
- **Output route:** <exact route, e.g. built-in speaker, Bluetooth to JBL Flip 6, USB-C DAC,
  3.5 mm, HDMI dock; include the speaker or DAC model>
- **Power and posture:** <on power or battery; foreground; wake lock state; relevant settings
  such as auto-lock, battery saver, Guided Access on or off>

## The run

- **Dates:** <start and end dates>
- **Hours:** <start and end clock times, and total hours observed>
- **Who observed:** <name; state their role: implementer, owner-delegated, or independent>

## What was seen

<Chronological notes: every interruption exercised and what happened, every status change and
whether it told the truth, every recovery and how long it took, anything unexpected. Include the
interval log the protocol asked for. A failure stays here in full; it is a finding, never deleted
for a retry. Attach or link raw artifacts (photos, screen recordings, exported logs) by filename.>

## Verdict

- **Verdict:** <GO / NO-GO / finding recorded, with one sentence of justification tied to the
  gate's acceptance words>
- **Verification status:** <implementer-run / owner-delegated / independently Verified by <name>
  on <date>>
- **Follow-up:** <what happens next: re-run, fix, or register row update with the commit that
  changes it>
```

---

## Field notes

- **Device model.** The exact hardware identifier, not the marketing family. "iPad" is not a
  model; per ADR-0466, testing one iPad and claiming iPads is the rejected representative-device
  inference. One record covers exactly one physical device.
- **OS build and browser engine and version.** Full build strings, because the staleness rule
  compares versions: a browser major release or OS update returns this tuple to unknown, and only
  precise versions make that detectable.
- **RAM and chipset.** Budget devices share APIs with flagships while differing hugely in RAM,
  thermal headroom and latency (ADR-0460); these fields are why per-tuple records exist.
- **SelectaDJ engine version.** The commit or build id of the web engine under test, so an engine
  change can reopen affected gates precisely.
- **Source and codec.** Decode behaviour is codec- and source-dependent; a record proving FLAC
  playback says nothing about AAC.
- **Output route.** Routes are qualified per device class including disconnect and reconnect
  (BF-0460-04); a built-in-speaker record never covers Bluetooth.
- **Who observed.** A person, named. Analyser data never proves sound (ADR-0460); only a human
  hearing it does, and the register must know whether that human was the implementer,
  owner-delegated, or independent. Owner-delegated checks are recorded as owner-delegated, never
  as independently Verified. Community or remote evidence is acceptable only with these same
  fields and an identified observer.
- **What was seen.** Prose beats checkboxes here: the venue failure modes (silent audio under a
  green status, slow recovery, thermal throttling) live in the observations, not the verdict.
- **Verdict.** GO means this record supports its gate for this tuple only. A failed run records
  NO-GO or "finding recorded" and keeps the failure; retry-until-green is rejected by ADR-0466.
