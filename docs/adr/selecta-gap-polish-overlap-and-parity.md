# Selecta - full-product source, overlap and feature parity matrix

**2026-11-12 status (recounted from the task lines of the [checklist](selecta-gap-polish-implementation-checklist.md)):** 16 Accepted ADRs (0248-0263, owner accepted 2026-11-08); 128 GP tasks: 111 Implemented, 0 In progress, 17 Not started (each names a person-only step); **0 independently Verified**.

**Historical 2026-11-08 planning baseline:** **16 Proposed ADRs (0248–0263), 128 new GP tasks Not started, 0 In progress, 0 Implemented and 0 independently Verified.** Planning baseline main `2956bc47fd735339e7216e03d27817fb3a31e92b` on 2026-11-08. Owner decisions remain pending. This PR changes only documentation; it neither implements code nor changes historical SF/CI/MI or earlier statuses.

The supplied screenshots cover only some Listen/Edit states. This map reviews **all primary surfaces** and identifies the accepted owner of already-covered functionality.

| Surface | Existing accepted ADR owner | Novel GP delta | Source touchpoints |
|---|---|---|---|
| First run and six-ready setup | ADR-0229, ADR-0238 | GP-0263 diagnostic/repair only | `Start.tsx, Setup.tsx` |
| Listen, lyrics, Stage, waveform and 15 spectrum styles | ADR-0209–0215 | GP-0248/0249 title and attention; GP-0254 device; GP-0257 comfort | `Now.tsx, player.ts` |
| Explore and mix shaping | ADR-0216, 0217, 0222 | GP-0259 expectation and comparison | `Mixes.tsx, MixSetup.tsx` |
| My Mixes, drafts and current performance | ADR-0228 | GP-0255 return to validated work | `MyMixes.tsx, Drafts.tsx` |
| Create, arrangement, seams and inspector | ADR-0219–0221 | GP-0250 selected focus and GP-0255 continuation | `Mix.tsx, SeamInspector.tsx` |
| Stem Studio and AI cell diff | ADR-0223–0224 | GP-0261 novice conceptual model; GP-0256 context help | `Studio.tsx, studio.ts` |
| Requests and consented joining | ADR-0225 | GP-0262 waiting truth only | `Requests.tsx` |
| Word and Harmonic Discovery | ADR-0218 | GP-0260 verified pair handoff | `Links.tsx` |
| Library, Song Details and source identity | ADR-0226–0227 | GP-0251 relevance, GP-0252 relocation, GP-0258 batch | `Library.tsx, SongDetails.tsx` |
| Workspace and source health | ADR-0230, 0232 | GP-0253 backup, GP-0263 diagnostics | `Workshop.tsx, WorkshopPanels.tsx` |
| FLAC exports and job queue | ADR-0231 | No duplicate GP ADR: preserve existing exact frozen-revision export requirements | `ExportPanel.tsx, ExportJobs.tsx` |
| Navigation, player and command palette | ADR-0208–0209, 0244 | GP-0251 commands, GP-0254 interruptions, GP-0255 returning context | `Shell.tsx, commands.ts` |
| Themes, a11y, performance and independent QA | ADR-0200–0207, 0233–0247 | GP-0248 content extremes and GP-0257 comfort; reuse earlier gates | `styles/*, web/e2e/*` |

## Safety/parity contract

Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

**No missing-feature inference:** Existing Play/Pause, previews, exact tracks, preferences, project revisions, Studio controls and 15 visualizers exist in source and are not to be reimplemented without evidence. GP status means its **additional acceptance** has not been evidenced. Reconcile each GP item against source, previous SF task and linked tests. Avoid broad extra navigation schemes, an unverified search index, cloud sync or wholesale scene rework.

**Testing:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.
