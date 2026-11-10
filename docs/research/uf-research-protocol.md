# Unified finish research protocol: cohorts, uncoached scenarios and honest conclusions

The written protocol for ADR-0367 (UF-0367-01 to UF-0367-08). It extends
[flow-research-protocol.md](flow-research-protocol.md), whose ground rules (uncoached cards, fresh
made-up library, participant codes, one outcome per task) apply unchanged. It is not a result: no
session has been run under it, and nothing here is evidence that Selecta is easy, accessible or
better than before.

Written 2026-11-10. Checked by `tests/test_uf_research_protocol.py`.

## Cohorts (UF-0367-01)

Three cohorts are recruited and reported separately, never pooled:

| Cohort | Who | Recorded sample details |
|---|---|---|
| New listeners | Have not used Selecta or DJ software | age band, music app used most, device, input |
| Experienced editors | Have mixed or edited audio before | years of practice, tools used, device, input |
| Assistive-technology users | Use a screen reader, magnifier, switch or voice control daily | AT and version, browser, OS, zoom level |

Each report states the number of people per cohort, how they were found, and anyone who dropped out.

## Uncoached scenarios (UF-0367-02)

| Task | Card read to the participant | Done means |
|---|---|---|
| U1 First ready mix | "Get some of your music playing as a mix." | Sound from a mix of ready songs, with no song played that was not ready |
| U2 Exact song | "Find the song called <title> by <artist> and play a mix that starts from it." | That exact recording (not a same-titled one) is the first song |
| U3 Lucy proposal | "Ask the assistant for a calm mix, look at what it suggests, and keep it as a draft." | A draft saved from the proposal; nothing played or replaced the current mix |
| U4 Seam edit | "Make the change from the second song to the third one start earlier." | Only that seam changed; the participant can say which songs it joins |
| U5 Bridge | "Ask for <title> next, and agree to any extra songs needed to get there." | The request is placed only after the extra songs were shown and agreed |
| U6 Export | "Save this mix as an audio file." | A FLAC of the revision on screen when saving began |

A dry run with a colleague who knows the app checks that each card is neutral (it never names a
control or route) before any participant sees it.

## What is measured (UF-0367-03)

One row per participant per task: outcome (Done unaided, Done with stall, Gave up, Wrong result),
errors (count and what they were), time from card to outcome, confusion moments (facilitator notes
with timestamps), confidence after the task (1 to 5, "How sure are you that it did what you
wanted?"), and recovery (whether an error was noticed and undone without help). The baseline
sessions run on the UF planning SHA `f17944530d54203e49baebdabc08a57ee9f40526`.

## Threshold, agreed before any study (UF-0367-04)

Proposed: at least 90% critical-task success in each cohort separately. It is only a target until a
named owner signs and dates it here, before the first candidate session. With small cohorts the
report gives the count (for example 9 of 10) and its interval, not just a percentage.

| Signed by | Date | Threshold agreed | Caveats |
|---|---|---|---|
| - | - | - | - |

## Matched comparison (UF-0367-05)

Baseline and candidate sessions use the same six cards, the same made-up library (or the same real
folder), the same device class and the same task order. A candidate session never uses a task that
was simplified after the baseline.

## Lifecycle vocabulary exercise (UF-0367-06)

After U1, U3 and U6, the facilitator points at the screen without naming anything and asks "What is
this song or mix doing right now?". Answers are coded for whether the person tells apart: analysed,
mix-ready, proposal, draft, rendering and playing. Prompting with the words themselves is not allowed.

## Friction to implementation (UF-0367-07)

Every usability defect found is filed with all five fields, or it is not filed:

| Field | Example |
|---|---|
| Route | `/mixes/lucy/abc123` |
| Source | `web/src/views/LucyApprove.tsx` (best guess, confirmed by the fixer) |
| Severity | Blocker (task cannot be done), Major (done only with help or a wrong result), Minor (slowed) |
| Reproduction | Numbered steps from a fresh made-up library |
| Expected outcome | What the participant expected, in their words, and what the app should do |

## How conclusions are written (UF-0367-08)

- Automated tests, screenshots and synthetic muted browser runs show behaviour, never usability or
  preference. They are never cited as user evidence.
- Small qualitative samples describe what was seen ("4 of 6 new listeners ..."); they never claim
  statistical superiority, significance or a percentage improvement over the baseline.
- A claim of improvement needs matched baseline and candidate data (above) and a stated sample size.
- The report is reviewed by someone who did not run the sessions before it is shared.
