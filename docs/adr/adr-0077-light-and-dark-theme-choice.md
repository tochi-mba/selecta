# ADR-0077: Choosing light or dark

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 3 of 6 tasks implemented with automated evidence on 2026-11-11; 1 need a person; 2 still open
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 2 - Foundations
- **Extends existing decisions:** ADR-0003, ADR-0050, ADR-0070, ADR-0072
- **Asked for by:** the owner, while PR 24 was being built

## Context and rationale

Selecta already had two sets of colours in `tokens.css`, and they followed the operating system. There was no way to choose. Someone with a dark desktop couldn't use the light look, or the reverse, and the installed app's title bar could only follow the system.

ADR-0050 asked for both themes to exist, but nothing asked for them to be chosen.

The light look also lost the brand. Lime can't be text or a thin line on cream, because it has almost no contrast, so light replaced it with a dark olive everywhere, including the main button.

## Decision proposed

Offer three choices: **Match this computer** (the default, so nothing changes for anyone who doesn't look for it), **Light** and **Dark**.

Bring lime back to the light theme where it can work: only as a filled shape with dark ink on it and a dark edge round it. Everywhere else in light, text, focus rings and thin lines keep the dark accent that has the contrast.

## Experience and frontend architecture

- **Where it's chosen:** a menu in the header bar on every page, the same choice in Workspace, Diagnostics, Interface, and in the command palette.
- **How it's kept:** in `state/prefs.ts`, in this browser's storage. It's a look, not your data, so no server route, database field or setting file is involved. A browser that can't store it goes back to following the computer.
- **How it applies:** `data-theme` on the root element, which `tokens.css` already understood. An inline script in `index.html` sets it before the first paint, so a chosen theme never flashes the other one.
- **The title bar:** `theme-color` follows the choice.
- **Things drawn in code:** the spectrum reads its colours from the page, so it redraws when the theme changes, including when the system changes while it's set to follow.

## Detailed implementation work

1. **S3-0077-01 - Implemented.** Add the `theme` preference, defaulting to following the computer, with unrecognised saved values ignored. **Evidence:** web/src/state/prefs.ts theme preference defaulting to system; web/src/state/prefs.test.ts 'saved ... with the OS ... shows ...' rows and 'storage that refuses to be read follows the OS, and a choice still holds until the page closes'; web/src/state/prefsStorage.test.ts 'ignore values of the wrong type or outside the known choices' (passed 2026-11-11).
2. **S3-0077-02 - In progress.** Apply it before first paint and keep it applied through `data-theme`, including the title bar colour.
3. **S3-0077-03 - Implemented.** Header menu with radio semantics, Workspace radio group and palette commands, all showing the current choice. **Evidence:** web/e2e/s3-0077-theme-choice.e2e.ts 'header, Workspace and palette choose the theme and all show the same current choice (S3-0077-03)' (passed 2026-11-11).
4. **S3-0077-04 - Implemented.** Semantic tokens for the main action and the current lyric word, so lime returns to the light theme without failing contrast. **Evidence:** web/src/styles/tokens.css semantic --primary-fill, --primary-ink and --primary-edge per theme; web/e2e/s3-0077-theme-choice.e2e.ts 'every page passes automatic contrast checks with light chosen while the computer is dark (S3-0077-04/06)' and the dark-on-light case (passed 2026-11-11).
5. **S3-0077-05 - In progress.** Redraw the spectrum when the shown theme changes.
6. **S3-0077-06 - Needs a person.** Run the automated contrast checks with the theme chosen explicitly, as well as following the system. **Status:** Needs a person: a person checking both themes by eye and with assistive technology; the automated half, web/e2e/s3-0077-theme-choice.e2e.ts 'every page passes automatic contrast checks with light chosen while the computer is dark (S3-0077-04/06)' and the dark case, passed 2026-11-11

## Preservation and integration constraints

No source music, mix, draft, rating or server state is touched by this. Reduced motion, focus visibility and non-colour status marks apply the same in both themes. No new dependency, font or network request.

## Required tests and edge-case verification

- Each choice applies, persists across a reload and survives a page change. Going back to following the computer removes the override.
- A chosen theme wins over the opposite system setting, in both directions.
- Invalid or unavailable storage falls back to following the computer without an error.
- Automated contrast checks pass on every page in both themes.
- Playback doesn't restart or pause when the theme changes.

## Alternatives, risks and trade-offs

A two-way toggle is simpler, but makes following the computer impossible to return to. A server-side setting would follow you between browsers, but there's only one machine, and a look isn't worth a schema or API change. Putting it only in Workspace would hide something people look for at the top of the page.

Lime as a filled button on cream is a stronger look than the old olive. The contrast of the button's text and edge is measured, but whether it looks right is the owner's call.

## Acceptance and evidence

A person can choose light or dark from any page and it stays chosen. Both themes must pass automated contrast checks before completion. Evidence is in [the ledger](selecta-3-evidence.md). **Verified** needs the owner to look at both.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | In progress on PR 24 | Automation and human review must be confirmed before completion |
| 2026-11-08 | Accepted | In progress on PR 24 | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [ADR-0050: palette, type and density](adr-0050-brand-tokens-type-and-density.md)
- [Words, explanations and motion](selecta-3-glossary.md)
