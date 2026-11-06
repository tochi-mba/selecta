# How Selecta's sound gets judged

Automated tests prove the timing, the files and the pages. They can't tell whether a transition sounds good, so that part is done by people and recorded separately. Passing the audit is never reported as sounding good.

## Quick check after any change to transitions

1. Start the app with `dev.cmd`, or use the running site.
2. Build a mix from **Selecta's pick** and open **Listen**.
3. Press **Jump to the transition** on at least ten transitions that use different moves.
4. Rate each one Good or Bad as it finishes. The ratings are saved against that exact pair of songs and move.
5. Read them back with `selecta ratings`.

Write down anything that sounded wrong, and when in the transition it happened. Note whether the song's beat, a lyric or the level was the problem.

## Blind comparison

The **Listening tests** page plays two versions of a transition, labelled only A and B, and never says which method made which.

1. Use a study code, so results from different people stay apart.
2. Prefer outside listeners as well as yourself, ideally some with DJ experience. You know your own songs, which changes what you notice.
3. For each trial, listen to both, rate quality from 1 to 5, tick any problems you heard, and choose A, B, No preference or Cannot judge.
4. Finish the set in one sitting if you can. A failed save can be retried, and the same trial can't be stored twice.

## What gets reported

- **The main number is the share of bad transitions**, rated 2 or lower, rather than the average rating.
- Report results for each method, including where Selecta loses.
- Keep these results apart from test results and audit passes.
- Changing what a study asks, or how it's scored, needs its own decision record, so results stay comparable.

Results don't belong in this repo if they include anything private. Song names and listener codes stay on your own computer.
