# Selecta — MP candidate pixel geometry and states

**Status:** 28 Proposed ADRs (0272–0299); 224 acceptance tasks Not started; 0 In progress; 0 Implemented; 0 Independently Verified. Owner unassigned. Planning baseline main `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4` (2026-11-08). Docs only.

## Geometry data record

`task ID | source selector | route/state | SHA | viewport×height | zoom | theme/density | metadata fixture | computed old values | intended values/tokens | before/after screenshots | tests | reviewer verdict`. A proposed value is not a measured defect.

| Relationship | Candidate scale | Exception |
|---|---|---|
| Icon to label | 8px | Specialist dense controls documented |
| Label to help/error | 4–8px | Field association maintained |
| Peer controls | 8–12px | Main touch targets preferably 44px |
| Heading to body | 12–16px | Editorial hero can use more |
| Card internal grouping | 12–16px | Compact density documented |
| Default card padding | 24px | 16px dense variant allowed |
| Related blocks | 24px | Follow content hierarchy |
| Different sections | 32–48px | Narrow layout may compress |
| Mobile page gutter | 16px | Respect existing --gutter and safe-area |
| Musical graph gaps | 1–3px | Preserve musical semantics and hit targets |

Specific cascade inspection: `.panel` is 18px and `.card` 16px in `web/src/style.css`, overridden by 24px in `web/src/styles/polish.css`. Reconcile computed behavior before editing; this overlap is not itself evidence of a rendered defect.

**Full state matrix:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

Existing `web/e2e/paired-theme.e2e.ts` creates candidate Light/Dark fixtures but does not independently approve real playback, Stage, Studio, consent bridge, export progression or physical-device visuals.

References: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/), [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/), [web.dev Web Vitals](https://web.dev/articles/vitals), [Mixxx UI manual](https://manual.mixxx.org/2.5/en/chapters/user_interface.html).
