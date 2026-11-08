# Baselines, support boundary and kinds of evidence

## Programme heads

Each programme was planned against one commit and implemented in the PRs below. This completion
pass starts from `main` at `256b6cef76fe7ba47ddaed8849c62a6296b0222d` (after PR #36).

| Programme | Task IDs | Planned at | Implemented and merged in |
|---|---|---|---|
| Selecta 2.0 | T0001–T0279 | `911c981` | [#22](https://github.com/tochi-mba/selecta/pull/22) → `fe785ec` |
| UI/UX polish | P0001–P0143 | `fe785ec` | [#23](https://github.com/tochi-mba/selecta/pull/23) → `84b8b5c` |
| Selecta 3.0 | S3-0047-01–S3-0077-06 | `84b8b5c` | [#24](https://github.com/tochi-mba/selecta/pull/24) → `3b01dc1` |
| Selecta 3.1 | S31-0078-01–S31-0088-12 | `3b01dc1` | [#25](https://github.com/tochi-mba/selecta/pull/25) → `6d78cf4` |
| Selecta 4.0 | S4-0089-01–S4-0113-10 | `9b663f9` | [#29](https://github.com/tochi-mba/selecta/pull/29) → `6638ec2` |
| Experience-first | EX-0114-01–EX-0134-05 | `6638ec2` | [#30](https://github.com/tochi-mba/selecta/pull/30) → `525a49c` |
| Microinteractions | MI-0135-01–MI-0164-08 | `525a49c` | [#31](https://github.com/tochi-mba/selecta/pull/31) → `c6c0a73`, [#32](https://github.com/tochi-mba/selecta/pull/32) → `4c2f9f0` |
| Creative interface + visualizers | CI-0165-01–CI-0184-07, ADR-0185–0197 | `4c2f9f0` | [#33](https://github.com/tochi-mba/selecta/pull/33) → `c3715b1` |
| Selecta Flow | SF-0198-01–SF-0247-08 | `c3715b1` | [#34](https://github.com/tochi-mba/selecta/pull/34) → `2956bc4` |
| Gap polish | GP-0248-01–GP-0263-08 | `2956bc4` | [#35](https://github.com/tochi-mba/selecta/pull/35) → `5347e73` |
| Final polish | FP-0264-01–FP-0271-08 | `5347e73` | [#36](https://github.com/tochi-mba/selecta/pull/36) → `256b6ce` |
| Completion pass | every open item above | `256b6ce` | [#37](https://github.com/tochi-mba/selecta/pull/37) |

The pre-redesign app is commit `911c981`; its routes, API and settings can be read with
`git show 911c981:<path>`. [selecta-3-baseline.md](../selecta-3-baseline.md) holds the 3.0 inventory,
task scripts and defect rules, which still apply.

## Support boundary

| | Supported | Notes |
|---|---|---|
| Server | Python 3.12, FFmpeg, on the same PC as the browser | `uv sync --locked`; local addresses only |
| OS | Windows 10/11 (the owner's machine and CI) | macOS/Linux untested |
| Browser | Microsoft Edge and Chrome (Chromium), current | Firefox and Safari: page works, installed app and `theme-color` behaviour differ |
| Installed app | Edge/Chrome PWA, still needs the local server | no offline playback without the server |
| Devices | desktop and laptop, phone/tablet browsers on the same network are not a target | layouts are tested from 320 px to 3840 px |
| CI | GitHub Windows runners (Python, Edge e2e) and Ubuntu (web build) | see [ci.md](../../ci.md) |

## Kinds of evidence

| Kind | What it proves | Example |
|---|---|---|
| Source | the code exists and does what it says | a file path |
| Unit / component test | behaviour in jsdom or Python with fakes | `web/src/views/Library.test.tsx` |
| Real-browser test | behaviour in muted headless Edge against a real server | `web/e2e/listen.e2e.ts` |
| Rendered capture | what a state looks like (candidate only) | `web/e2e/paired-theme.e2e.ts` |
| Audible | how it sounds | only a person; see [needs-a-person.md](needs-a-person.md) |
| Human judgement | usability, comfort, screen-reader use, approval | only a person |
