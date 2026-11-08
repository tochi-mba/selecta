# Selecta / Flow — independent NO-GO release gates

**New redesign programme verdict: NO-GO / NOT IMPLEMENTED OR INDEPENDENTLY VERIFIED.** This is an intentionally strict future acceptance verdict for 50 **Proposed** ADRs and 400 **Not started** SF tasks. It is *not* evidence that the existing application is broken or unsafe. Source implementation remains a future separate PR; original historical statuses remain untouched.

| Gate | Required objective proof | Current status |
|---|---|---|
| Decision & baseline | Dated acceptance/rejection for 50 new ADRs, exact implementation SHA, previous-programme source reconciliation | Pending |
| Art direction | Owner-approved dark/light variants with no critical usability regression | Pending |
| Truth provenance | Decorative, requested, measured, rendered and playing data mapped accurately | Pending |
| Single audio owner | No double playback or surprise resume across scenes, Studio, previews and tabs | Pending |
| Manual transport & seek | Pause, volume, media keys, blocked seam seeking, real clock correct | Pending |
| Real handoff | Correct pair, technique, fallback and audio-video seam correlation | Pending |
| Visualizer art and safety | All 15 actual modes, silence, pause, reduced motion, power cap, AT names | Pending |
| Current/draft/revision | Stable song/pair scope, confirmation, optimistic rollback and Undo | Pending |
| Explore intention and mix generation | Only supported planner controls and server-confirmed resulting plan | Pending |
| Requests and bridges | Required explicit bridge approval and all-or-none song insertion | Pending |
| Stem Studio | Eight lanes, 8–64 cells, Shape/Grid/List, exact AI cell diff and recovery | Pending |
| Library and metadata | 20k-song search/filter, truthful ready/unknown, original files intact | Pending |
| Local privacy | Local server and path safety, LRCLIB metadata disclosure, no cloud dependency | Pending |
| Export integrity | Exact frozen mix revision and decodable FLAC with truthful job status | Pending |
| Accessibility | Keyboard, NVDA/Edge, forced colors, 320px reflow, 400% zoom, meaningful target sizes | Pending |
| Sensory safety | Reduced motion, Still preference, no fake musical animation or seizure hazard | Pending |
| Real performance | Named hardware under audio+analysis/render load, measured INP/CLS and audible dropout assessment | Pending |
| Research | Uncoached listener/creator/DJ results with denominators; blind A/B neutrality | Pending |
| Screenshot approval | Candidates evaluated, named human reviewer, dark/light and error states | Pending |
| Rollback | Old→new→old preserves song files, draft/current scope, prefs, queue and job histories | Pending |
| Release sign-off | P0 resolved, P1 explicitly dispositioned and named owner/independent reviewer sign exact SHA | Pending |

## Blocking severity

- **P0 — must not ship new UI slice:** wrong song/current mix/seam/revision, corruption/rewriting local audio, unconsented or partial bridge, overlapping audio or surprise resume, visually claimed playback that did not happen, false rendered/lyric timing/progress, corrupt or wrong-revision FLAC, inaccessible essential control, unsafe flashing, exposed private media or unsafe filesystem behavior.
- **P1 — require documented disposition before release:** confused primary task, major mobile/high-zoom/forced-color failure, a Studio recovery loss, severe animation jank, unexplained processing stage, no-action failure recovery or significant dark/light legibility regression.
- **P2 — cosmetic follow-up only:** small noncritical spacing, shadow, type or icon inconsistency with no control/meaning/access impact.

## Evidence needed for each release slice

1. Accepted owner decision with versioned design specimens and source baseline.
2. Narrow implementing PR/SHA, relevant unit/contract/E2E source tests and feature-preservation proof.
3. Independent reviewer with date, exact tested SHA, named OS/browser/device, all relevant view sizes, AT and sensory results, and real audio assessment where musical effects are significant.
4. Actual frozen-revision FLAC validation where export touched; server privacy and original media proof where local paths/storage touched.
5. Real-performance profile under relevant sustained load and signed rollback plan.
6. Explicit owner and independent reviewer GO/NO-GO. Do not promote Verified based on a docs PR, synthetic muted E2E, green tests or generated screenshot candidates alone.

[Checklist](selecta-flow-implementation-checklist.md) · [Independent ledger](selecta-flow-implementation-evidence.md) · [Verification](selecta-flow-verification-matrix.md) · [Roadmap](selecta-flow-roadmap.md).
