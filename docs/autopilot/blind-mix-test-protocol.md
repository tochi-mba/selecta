# Blind mix test protocol (ADR-0438, AV-0438-03)

**Status:** Protocol and tooling ready (`src/selecta/venueops/blind_test.py`). No sessions have
been run and no results exist. Running sessions with listeners is a person step.

## Question

Do listeners prefer SelectaDJ's unattended transitions and song order to what a venue uses today,
when they don't know which is which?

## Conditions

- `selectadj`: an Autopilot venue night excerpt rendered from the release candidate SHA.
- `playlist`: the same songs in a shuffled playlist with a plain player crossfade.
- `reference` (optional): a human DJ's mix of comparable songs, used with the DJ's written consent.

Use only material cleared for the setting where the test runs (ADR-0434). Excerpts are two to
three minutes long and contain one transition in the middle. Loudness-match every excerpt (same
integrated LUFS, within 0.5 LU) so level does not decide the preference.

## Participants

- 12 or more listeners who spend time in bars or cafés; at least four who work in one.
- Nobody who built SelectaDJ or knows which condition is which.
- Consent recorded outside the repository; participants are coded P01, P02 ...

## Running a session

1. Generate the plan: `python -m selecta.venueops.blind_test plan.json --participants 12 --out
   <dir>`, where plan.json maps each condition to its excerpt ids.
2. The session runner keeps `sealed-key.json`; the listener sees only trial ids and A/B. Every pair
   of conditions appears equally often, and each condition is A as often as B.
3. Play A then B on the same speaker at room level (about 75 dB(A) at the listener).
4. For each trial record which they prefer (A or B) and, for each excerpt, a 1 to 5 rating for
   `transition_smoothness`, `fits_the_room` and `would_keep_playing`.
5. After the session, not before, ask whether they could tell which system made which excerpt.

## Scoring

`blind_test.score(key, responses)` reports per condition the preference rate and mean ratings, and
per pair an exact two-sided binomial p-value. Report counts as they are; never drop participants
after seeing their answers. A preference claim needs p below 0.05 on the pair named before the
test (`selectadj` versus `playlist`).

## Recording

Keep raw responses outside the repository. Put only the scored summary, the SHA that rendered the
excerpts, the date and the session runner's name into the evidence ledger.
