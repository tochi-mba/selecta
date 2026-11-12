# Gap polish research protocol: person-run studies and device run sheets

The written protocol for the GP tasks that only people can close (GP-0248-08 to GP-0263-08,
GP-0254-05, GP-0257-04 and GP-0258-01). It follows the ground rules of
[flow-research-protocol.md](flow-research-protocol.md) and
[uf-research-protocol.md](uf-research-protocol.md): uncoached cards that never name a control,
a fresh made-up library unless a task says real music, participant codes (P01, P02 and so on)
and never names, one outcome per task, cohorts reported separately and never pooled.
It is not a result: no session has been run under it, and nothing here is evidence that the GP work helped.

Written 2026-11-12. Checked by `tests/test_gp_research_protocol.py`. Results are scored by
`src/selecta/audit/gp_study.py` (tests in `tests/test_gp_study.py`), which refuses any column
outside its allowlist, any participant that is not a code, and any conclusion without a
threshold signed here before the first session.

## Shared rules

- Result sheet columns: `study, participant, cohort, session, task, outcome, seconds,
  wrong_scope, rating, predicted`. Nothing else is recorded in the sheet.
- Task outcomes: `done_unaided`, `done_with_stall`, `gave_up`, `wrong_result`. Question outcomes
  (where a card asks the participant to predict or recall): `correct`, `incorrect`, `unsure`.
- Sessions: `baseline` runs on the GP planning SHA `2956bc47fd735339e7216e03d27817fb3a31e92b`,
  `candidate` on the SHA under test, with the same cards, library, device class and task order.
  Longitudinal studies use `visit-1` and `visit-2`.
- At least 5 people per cohort before the scorer states whether a threshold was met; with small
  cohorts the report gives counts and the 95% interval, not just a percentage.
- A dry run with a colleague checks each card is neutral before any participant sees it.

## Thresholds, signed before any session

Proposed for every task study: at least 80% `done_unaided` (or `correct`) per cohort in the
candidate session, and no `wrong_scope` change at all. It is only a target until a named owner
signs and dates the row.

| Study | Signed by | Date | Threshold agreed | Caveats |
|---|---|---|---|---|
| any GP study | - | - | - | - |

## First-glance readability (GP-0248-08)

Cohort `listeners`. Each card shows Listen for five seconds, then hides it.

| Task | Card | Correct means |
|---|---|---|
| R1 | "What song is playing, and who is it by?" (long Latin title) | Title and artist both recalled |
| R2 | The same with a right-to-left or non-Latin title | Title recognised from a list of four |
| R3 | The same on a 320px wide phone layout | Title and artist both recalled |

Run in both themes. Baseline versus candidate compares counts of `correct`.

## Control discovery time (GP-0249-08)

Cohorts `listeners` and `djs`, reported separately. `seconds` runs from card to first correct press.

| Task | Card | Done means |
|---|---|---|
| D1 | "Make the moving picture behind the music look different." | Visualizer style changed |
| D2 | "Show the words of this song." | Lyrics visible |
| D3 | "Change what plays after this song." | Next-song steering opened and used |
| D4 | "Ask for a particular song to play soon." | A request placed |

## Seam selection and audition (GP-0250-08)

Cohort `creators`, real audio on headphones.

| Task | Card | Done means |
|---|---|---|
| S1 | "Pick the change from the second song into the third." | Exactly that transition selected |
| S2 | "Listen to just that change." | Only that transition played |
| S3 | "Now listen to the whole mix from the start." | Playback from the first song |

`wrong_result` when another transition or song was selected or played.

## Return to the intended task (GP-0255-08)

Cohorts `listeners` and `creators`. Longitudinal: `visit-1` ends mid-edit on a draft with a
transition still waiting; `visit-2` is two to seven days later, with no reminder of what they did.

| Task | Card | Done means |
|---|---|---|
| T1 | "Carry on with what you were doing last time." | The same draft and transition reopened |
| T2 | "Finish that change and keep it." | Only that draft changed |

`wrong_scope` is 1 when the current mix, another draft or another transition changed, or when
playback started without the participant pressing Play.

## First-time advanced tasks (GP-0256-08)

Cohort `novices`: people who have not used Selecta, Studio or DJ software.

| Task | Card | Done means |
|---|---|---|
| A1 | "Make the singing of the next song come in later." | The vocal lane changed in Studio and applied |
| A2 | "Ask for a song that needs extra songs to get to it." | Request placed after the extra songs were agreed |
| A3 | "Is the change you made already what you will hear?" | Rendered versus heard answered correctly |

## Sustained-session comfort (GP-0257-08)

Cohorts `listeners` and `djs`. One task, C1: a 60-minute session of ordinary use in a dimly lit
room, in the participant's usual theme. `rating` is "How comfortable was that to look at and
listen to?" (1 to 5). The facilitator notes every interruption that drew the eye; the attention
trace from `web/src/ui/gp-0257-comfort.test.tsx` is the budget it is compared with.

## Low-light contrast assessment (GP-0257-04)

What code measures is in `tests/test_s4_contrast_pairs.py` (every text, status and mark role on
every surface in both themes) and `tests/test_gp_0257_low_light.py` (no glowing dark surface,
dark reading text not pure white, warm colours, no pure white light surface). The person part:

| Display | Theme | Room light | Minutes | Glare or halation seen | Eye strain (1 to 5) | Reviewer | Date |
|---|---|---|---|---|---|---|---|
| - | Dark | dim | 30 | - | - | - | - |
| - | Light | dim | 30 | - | - | - | - |

## Demand for multi-song operations (GP-0258-01)

Cohorts `listeners` and `creators`. Interview cards, no app on screen.

| Task | Card | Correct means |
|---|---|---|
| B1 | "Tell me about the last time you wanted to change many songs at once." | A concrete recent case given |
| B2 | "What did you want to change on all of them?" | A field the batch editor supports |

`rating` is how often it happens (1 never to 5 weekly). The report quotes no participant.

## Predicted versus actual satisfaction (GP-0259-08)

Cohort `listeners`. `predicted` is recorded from the mix card alone, `rating` after ten minutes
of listening (both 1 to 5); the scorer reports the mean gap.

| Task | Card | Done means |
|---|---|---|
| E1 | "Pick the mix you think you will enjoy most and say how much." | A mix started |
| E2 | "Pick one you think you will enjoy least and say how much." | A mix started |

## Discovery to Create handoff (GP-0260-08)

Cohort `creators`, the participant's own real music folder on their own machine.

| Task | Card | Done means |
|---|---|---|
| H1 | "Find two songs that might go together and hear how they would join." | A Discovery audition heard |
| H2 | "Put that pair into your draft, not what is playing." | The pair in the named draft only |

`wrong_scope` is 1 when the current mix changed.

## Studio novice and expert editing (GP-0261-08)

Cohorts `novices` and `experts` (people who edit stems or mix audio). `seconds` compares
efficiency within each cohort only.

| Task | Card | Done means |
|---|---|---|
| ST1 | "Keep only the drums of the first song for the first eight bars." | That lane shape applied |
| ST2 | "Undo that and try it with the bass instead." | Drums restored, bass lane changed |

## Guaranteed versus tentative requests (GP-0262-08)

Cohort `listeners`. Each card shows a Requests state and asks a prediction question.

| Task | Card | Correct means |
|---|---|---|
| Q1 | A waiting request: "Will this play, and when?" | Says it may play, no time promised |
| Q2 | A placed request: "Will this play?" | Says yes, at the shown point |
| Q3 | A bridge offer: "What happens if you say no?" | Says nothing changes |
| Q4 | A stopped request: "What can you do now?" | Names the offered way forward |

## Nondeveloper fault recovery (GP-0263-08)

Cohort `nondevelopers`. The facilitator sets up each fault on a test machine first.

| Task | Fault set up | Card | Done means |
|---|---|---|---|
| F1 | ffmpeg removed from the path | "Saving as a file does not work. Fix it." | ffmpeg found and export works |
| F2 | Music folder moved | "Your songs say they are missing. Fix it." | Relinked, ratings kept |
| F3 | Export drive full | "The export failed. Find out why and try again." | Space freed and retry succeeds |

`wrong_scope` is 1 when other work was deleted or reset.

## Device run sheets

### Moved-folder recovery on a real drive (GP-0252-08)

Automated proof: `tests/test_folder_relink.py` and `tests/test_gp_relink_choices.py` move a
made-up folder and keep every ID, rating and draft item. The person moves a real music folder to
another drive, relinks it through Library, and records:

| Drive and file system | Songs | Moved without a prompt | Asked about | Ratings kept | Drafts play | Reviewer | Date |
|---|---|---|---|---|---|---|---|
| - | - | - | - | - | - | - | - |

### Independent restore (GP-0253-08)

Automated proof: `tests/test_local_backup.py` round trip. The person, not the author, writes down
three drafts, five ratings and two corrections, makes a backup, changes them, restores, restarts
and checks each one:

| Item | Before backup | After restore | Same | Reviewer | Date |
|---|---|---|---|---|---|
| - | - | - | - | - | - |

### Output disconnection and reconnection (GP-0254-05)

Automated proof: `web/src/gp-0254-reconnect.test.ts` replays unplugging and plugging back a USB
interface, wired headphones and a Bluetooth headset as the browser sees them. The person unplugs
each real output mid-song and records the continuity log:

| Output | OS and browser | Unplugged: shown state | Sound stopped | Replugged: started by itself | Play resumed at same place | Reviewer | Date |
|---|---|---|---|---|---|---|---|
| USB interface | - | - | - | - | - | - | - |
| Wired headphones | - | - | - | - | - | - | - |
| Bluetooth headset | - | - | - | - | - | - | - |

### Audibility on named devices (GP-0254-08)

An independent reviewer plays the same mix for two minutes on each named device, across one
transition, and records whether the music, the transition and the seam preview were heard:

| Device (make and model) | OS and browser | Music heard | Transition heard | Seam preview heard | Reviewer | Date |
|---|---|---|---|---|---|---|
| - | - | - | - | - | - | - |
