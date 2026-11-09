# Selecta - MP verification matrix

**Status:** 28 Proposed ADRs (0272–0299); 224 acceptance tasks Not started; 0 In progress; 0 Implemented; 0 Independently Verified. Owner unassigned. Planning baseline main `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4` (2026-11-08). Docs only.

| Scope | Machine proof | Mandatory independent proof |
|---|---|---|
| 0272–0279 geometry | CSS computed dimensions, component-state and theme candidate fixtures | Human optical review and NVDA where applicable |
| 0280–0281 shell | Routes, player, overlay hitbox tests | Physical keyboard and real audio continuity |
| 0282–0285 listening | First run, Listen, 15 spectrum modes, real clock tests | Uncoached listener and actual handoff/Stage |
| 0286–0289 creating | Revision guards, Studio cells, editor geometry | Expert creator with actual sound and AT |
| 0290–0294 supporting | Request atomicity, Library 20k, FLAC, backup scenarios | Request consent, neutral studies, real export |
| 0295–0297 cross-cutting | Overlay, focus, async and reduced-motion E2E | Keyboard/AT and visual feedback review |
| 0298–0299 release | Exact required/captured/approved manifests and performance tests | Signed human visual, audio, device and GO/NO-GO |

**Negative cases:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

WCAG 2.2 AA including 2.5.8 targets (24×24 CSS px or exception), applicable text/nontext contrast and 400% zoom. Prefer 44px for core touch actions. Target lab INP ≤200ms, CLS ≤0.1 and LCP ≤2.5s, with named device; preserve Selecta's 15fps visualizer and 20k-song Library budgets. Screenshot automation does not prove human comfort or actual sound.
