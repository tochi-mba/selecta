# Blind study comprehension check (S4-0109-10)

A researcher runs this with each participant before their answers count, then signs the protocol
acceptance at the end. Nothing here is filled in by a program: a machine only checks that every
on-screen wording quoted below still appears in `web/src/views/Listening.tsx`
(`tests/test_s4_0109_comprehension_script.py`), so the script never asks about words the page no
longer shows.

## Setup

- A study made with `selecta listening-import`, at least three comparisons, one with a clip that will
  not play.
- The participant has not seen the study page before and is not told how the versions were made.
- Record: date, researcher, participant nickname (never a real name), listening setup, commit SHA.

## Observed tasks

Ask the participant to think aloud. Do not explain the page. Note hesitation over 10 seconds.

| # | Ask the participant to | Counts as understood when they |
|---|---|---|
| 1 | Open the study with the code you were given. | fill "Study code", "Listener nickname" and "Listening setup" and press "Open study" unaided |
| 2 | Tell me how many comparisons there are. | read "Comparison 1 of" and say the total |
| 3 | Answer this comparison. | play both versions before choosing, and say why "Prefer A" stayed unavailable until both were heard |
| 4 | This clip will not play. What can you do? | choose "Cannot judge" without prompting |
| 5 | Grade a version and name an issue. | pick a grade from "1 · Bad" to "5 · Excellent" and tick an issue only after grading |
| 6 | Leave this one for later. (only with the skip flag on) | use "Skip this comparison" and say that it saved nothing |
| 7 | Stop now and come back later. (only with the skip flag on) | use "Stop for now", then reopen with the same code, nickname and setup and land on the same comparison |
| 8 | Are you finished? | read the end message correctly: "All responses saved. Thank you for listening." only when none was skipped |

## Comprehension questions (after the tasks)

Write down the answer in the participant's own words. A wrong answer is a finding, not a failure of
the participant.

1. Do you know which version was made which way? (Understood: no, and the page does not say.)
2. What does "No preference" mean, compared with "Cannot judge"? (Understood: heard both and liked
   them equally, against could not tell or could not hear.)
3. Does your answer prove one version is better for everyone? (Understood: no, it is one person on one
   setup, as the page says.)
4. If you skipped a comparison, has it been answered? (Understood: no, it has no answer.)

## Protocol acceptance (researcher)

| Date | Researcher | Commit SHA | Participants | Tasks understood | Questions understood | Protocol accepted (yes / no, why) |
|---|---|---|---|---|---|---|

No session has been recorded yet.
