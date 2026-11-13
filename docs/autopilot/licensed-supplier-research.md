# Licensed music supplier research (ADR-0434, AV-0434-02)

Status: investigation template. Nothing here is a verified term, price or offer. Every candidate
below is an unverified lead to check with the supplier and a music-rights specialist. Do not
quote a row as fact until its "Verified by" column names a person and a date.

## What a venue needs a licence to cover

The venue rights gate (`src/selecta/venueops/rights.py`, matrix in
`src/selecta/venueops/rights_matrix.json`) asks about each of these operations, per territory:

| Operation | Rights it touches (to confirm with a specialist) |
|---|---|
| play_in_venue | Public performance of the recording and of the composition |
| stream | Communication to devices on the venue network; may count as a further copy |
| cache_offline | Reproduction (a copy on the venue device) and its time limit |
| render_seam | A derivative mix of two recordings; may need the rights holders' consent |
| stem_separate | Making new copies of parts of a recording; often excluded from standard licences |
| export | A copy that leaves the venue device |
| analyse_with_model | Text and data analysis of the recording; plus the model's own licence |

## Questions for each supplier

1. Which territories does the licence cover, and is it per venue, per zone or per device?
2. Does it cover the recording, the composition, or both? Which collecting societies remain
   separately payable (for example the local performing rights body)?
3. Does it allow offline caching? For how long, and how is expiry enforced?
4. Does it allow mixing two recordings into a transition (a new render)?
5. Does it allow stem separation or any other derivative processing?
6. Does it allow analysis (key, tempo, beats, lyrics) and keeping the results?
7. Can anything be exported or recorded?
8. What metadata and reporting (play logs) does the supplier require, and in what format?
9. What happens to cached copies and analysis when the contract ends?
10. Commercial terms: minimum term, price model, and whether a pilot is possible.

## Candidate leads (unverified)

| Lead | Kind | Why it is on the list | Verified by | Date | Findings |
|---|---|---|---|---|---|
| Background-music services for businesses | B2B in-store music supplier | Their whole product is licensed venue playback | - | - | Not investigated |
| The venue's local performing rights society | Collecting society | Usually needed for public performance in addition to any supplier | - | - | Not investigated |
| The venue's local recording rights society | Collecting society | Some territories license recordings separately | - | - | Not investigated |
| Production / library music catalogues | Direct-licensed catalogue | Often licensed for commercial use including edits | - | - | Not investigated |
| Independent labels or artists direct | Direct licence | Possible written licence naming mixing and stems | - | - | Not investigated |
| Deezer (for the S-KEY weights) | Model licence | Owner of S-KEY; a commercial licence would lift the block (ADR-0405) | - | - | Not investigated |

Names of specific companies are deliberately left out until someone checks them; add them with
a source link when a person does.

## Recording a finding

For each lead, fill in a row and a short section with: the source (contract, written email,
published terms with a link and date), the answers to the ten questions, and which cells of
`rights_matrix.json` it would let move from refuse or needs review to allow. Change the matrix
only after specialist approval.

## Person steps

- Contact the suppliers and collect written terms (AV-0434-02).
- A music-rights specialist reviews the matrix and the terms per territory and signs off
  (AV-0434-05). Passing tests never stand in for this.
