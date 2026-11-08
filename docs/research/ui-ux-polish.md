# Selecta UI/UX polish - research and inspection notes

- **Reviewed:** 2026-11-06
- **Purpose:** support [ADR-0033–0046](../adr/polish-roadmap.md), not claim implementation or usability validation.
- **Baseline inspected:** local main/origin/main at `fe785ec`.

## Evidence boundary

The review read the main frontend screens, shared controls/styles, player integration, relevant library routes and existing ADR/research/evidence files. Browser preview failed to attach, so no complete rendered-screen review, measured contrast audit, device test, screen-reader session or listening session was performed. Findings below are code/document observations; visual severity and user impact still require the planned baseline and task review.

The earlier [UI/UX research](ui-ux.md) contains useful precedents and explicitly labels excerpt-only reading. Do not silently upgrade those older claims to verified results. The sources below were opened or retrieved in this review; recommendations are Selecta-specific design judgments, not proof that any particular layout improves Selecta.

## Primary and specialist sources

1. **IBM Carbon - Loading** (page showed an August 11, 2026 update). Distinguishes content skeletons, loading indicators and progressive loading; skeletons represent structured content rather than every action or overlay. Apply to shaped initial-load placeholders, local action feedback and separate long-job status. [Source](https://www.carbondesignsystem.com/building-blocks/core/patterns/loading)
2. **W3C - WCAG 2.2.** Accessibility conformance target for contrast, keyboard access, focus, reflow and related criteria. Apply as a measured acceptance standard, not a claim that existing automated tests establish conformance. [Source](https://www.w3.org/TR/WCAG22/)
3. **W3C - Understanding Target Size (Minimum).** The AA target is 24 by 24 CSS pixels with specified exceptions, including spacing. Prefer larger touch controls where practical; do not confuse the proposed 44px design target with the AA minimum. [Source](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
4. **W3C - ARIA Authoring Practices: Tabs.** Defines tab focus, arrow navigation and selected-panel semantics. Apply to inspector tab widgets; ordinary navigation links remain links. [Source](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
5. **Nielsen Norman Group - Progressive Disclosure.** Specialist usability guidance for exposing frequent controls first and advanced controls on request. Apply to dense Library actions, Listen view options and mix customization; validate discoverability rather than hiding essential actions. [Source](https://www.nngroup.com/articles/progressive-disclosure/)
6. **Microsoft Research - Guidelines for Human-AI Interaction, CHI 2019.** The publication describes 18 guidelines evaluated through multiple rounds, including 49 practitioners assessing 20 products. Use as a framework for expectations, correction and explanation; it is not direct experimental evidence about Selecta or music-transition quality. [Source](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
7. **Mixxx 2.5 manual - User Interface.** Documents full/compact/mini deck views and separable interface sections. Use as a product precedent for optional depth and music context, not a requirement to imitate a live-DJ deck. [Source](https://manual.mixxx.org/2.5/en/chapters/user_interface.html)
8. **web.dev - Web Vitals.** Gives reference good thresholds of LCP <=2.5s, INP <=200ms and CLS <=0.1 at the 75th percentile, with mobile/desktop segmentation. Use recorded local measurements honestly; no field-percentile or compliance claim without matching evidence. [Source](https://web.dev/articles/vitals)

## Concrete inspection findings and planned response

| Observation | Source | Planned response |
|---|---|---|
| Skeletons are generic bars; reduced-motion handling already exists | `web/src/ui/controls.tsx`, `web/src/styles/shell.css` | ADR-0036: structured variants, preserved geometry and explicit failure exits; retain existing motion accessibility |
| Navigation/transport mixes symbol and emoji icon styles | `web/src/shell/Shell.tsx` | ADR-0034: one coherent local vector icon system |
| Library rows expose multiple simultaneous actions | `web/src/views/Library.tsx` | ADR-0043: scan hierarchy and accessible secondary actions, subject to visual/task review |
| Listen includes several optional displays and action groups | `web/src/views/Now.tsx` | ADR-0039: stable transport and deliberate viewing hierarchy |
| Listen song-detail fetch swallows errors | `web/src/views/Now.tsx` | ADR-0036/0039: failed/retry presentation instead of unresolved loading |
| Inspector tab roles do not include complete focus/navigation relationships | `web/src/views/SeamInspector.tsx` | ADR-0035: full tab interaction contract |
| A fourth actionable toast can displace the oldest Undo | `web/src/ui/toasts.tsx` | ADR-0035: preserve access to every sole recovery action under bursts |
| First-run path entry and readiness gating need distinct explanations | `web/src/views/Start.tsx`, `web/src/views/Mixes.tsx` | ADR-0037: folder guidance and actual readiness blockers |
| Scan launches lyric lookup while README says explicit lyrics command | `src/selecta/routes/library.py`, `README.md` | ADR-0037: verify triggers/data and reconcile disclosure; no new privacy claim in this planning change |
| Workshop contains developer ControlStates display | `web/src/views/Workshop.tsx` | ADR-0043: development-only review gallery |
| Energy preview normalizes current-song energy to its own range | `web/src/views/Mixes.tsx` | ADR-0038: audit comparison semantics before calling requested/achieved curves directly comparable |
| Existing ledger records missing visual baselines and unfinished human/scale checks | `docs/adr/implementation-evidence.md`, `web/e2e/pages.e2e.ts` | ADR-0045/0046: actual visual, assistive, task, constrained-performance and audible evidence |

## Design judgments to validate

- Preserve the existing warm identity and strengthen hierarchy before considering additional decoration.
- Stable controls and content-shaped loaders should reduce avoidable layout disruption; test actual transitions and task outcomes.
- Keep advanced music tools available through understandable secondary surfaces; verify users can find them unaided.
- Treat every meaningful state and fine visual detail as explicit scope, with named acceptance evidence rather than subjective completion claims.
- Keep the audio engine, study protocol, privacy boundaries and feature inventory intact. New backend/platform requirements need separately scoped implementation decisions.

## Open research and verification work

Capture the rendered baseline, measure contrast, check real zoom/touch/installed-app behaviour, test human screen-reader and listening journeys, and run unguided tasks. No participant count, performance result, visual approval or subjective quality result is fabricated in this plan.
