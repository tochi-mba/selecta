# Selecta — final-polish overlap, source ownership and full-product parity

**FP documentation proposal as of 2026-11-08:** baseline main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`. 8 Proposed ADRs (0264–0271), 64 task acceptances Not started, 0 In progress, 0 Implemented, 0 independently Verified. All owner decisions pending; no source change or human verification is claimed.

## How to read this matrix

These eight FP decisions are strictly additive *acceptance deltas*, not rewrites of the 50-ADR Selecta/Flow programme (SF) or 16-ADR gap-polish proposal (GP). Current code already has functioning design tokens, manual theme settings, 15 visualizers, exact Library batch transactions and 8-lane Studio; no one should implement duplicates just to mark FP as done.

Before any implementation, pin the **current** source SHA and map each FP task to the existing feature, exact SF/GP acceptance, relevant tests, and genuinely remaining delta. If prior code satisfies the same acceptance, request documented reconciliation; do not silently change statuses in other ledgers.

| Surface / journey | Existing ADR owner | New FP acceptance if any | Source touchpoint / protection |
|---|---|---|---|
| Start and first-run readiness | ADR-0229; GP-0263 | None: retain original flow, theme-state verification via FP-0271 | `Start.tsx`, `Setup.tsx`; no false readiness, original music private |
| Theme selection, visual tokens | ADR-0201, 0204, 0234; GP-0257 | FP-0264: functional boundary roles; FP-0265: chrome follows effective theme | `tokens.css`, `ThemeChoice.tsx`, `index.html` |
| Listen / Stage / lyrics | ADR-0209–0215; GP-0248, 0249, 0254, 0257 | FP-0266: live music graphic repaint; FP-0269: cross-route tier ownership only | `Now.tsx`, `spectrumVisuals.ts`; retain 15 actual visualizers, one audio clock |
| Explore / Mix setup | ADR-0216, 0217, 0222; GP-0259 | FP-0268: compact card information budget; FP-0269: consistent action tiers | `Mixes.tsx`, `MixSetup.tsx`; facts must be real/planned distinctions clear |
| My Mixes / Drafts | ADR-0228; GP-0255 | FP-0269 placement registry; FP-0271 paired views only | `MyMixes.tsx`, `Drafts.tsx`; no unexpected autoplay |
| Create / Edit / Inspector | ADR-0219–0221; GP-0250, 0255, 0256 | FP-0269 action hierarchy; FP-0270 stacking/occlusion; FP-0271 theme pairs | `Mix.tsx`, `SeamInspector.tsx`; exact occurrence and scoped revision |
| Stem Studio | ADR-0223/0224; GP-0261 | FP-0266 theme/parity of grid marks; FP-0270 viewport overlap only | `Studio.tsx`; eight lanes, Shape/Grid/List, 8–64 cells |
| Requests / consent | ADR-0225; GP-0262 | FP-0269 action tiers; FP-0270 overlay safety | `Requests.tsx`; explicit atomic bridge consent |
| Word/harmonic Discovery | ADR-0218; GP-0260 | FP-0269 cross-route registry; FP-0271 visual evidence | `Links.tsx`; no fabricated verified musical connection |
| Library selection and search | ADR-0226/0227; GP-0251, 0252, 0258 | FP-0267 empty-selection toolbar behaviour, **not** new batch API | `Library.tsx`, `routes/library.py`; stable IDs, exact loaded scope |
| Song details / corrections | ADR-0227; GP-0252 | FP-0271 paired visual evidence only | `SongDetails.tsx`; do not modify source audio |
| Workspace, Sources, Storage, diagnostics | ADR-0230, 0232; GP-0253, 0263 | FP-0269 action tiers; FP-0270 stacked chrome; FP-0271 theme pairs | `Workshop.tsx`, `WorkshopPanels.tsx`; local/privacy safe |
| Backup / Restore | GP-0253; ADR-0230, 0238 | FP-0271 UI-state pairing only | `LocalBackup.tsx`, `backup.py`; staged restore/rollback |
| Export jobs and saved FLAC | ADR-0231; GP existing preservation | FP-0271 UI-state pairing only | `ExportPanel.tsx`, `ExportJobs.tsx`; frozen revision, decodable file |
| Blind A/B study | ADR-0236; prior neutral evaluation contracts | FP-0271 evidence coverage; no protocol change | `Listening.tsx`; do not reveal treatment identity |
| Shell, overlays, PWA, mobile | ADR-0208/0209, 0233/0234; GP-0254 | FP-0265 browser chrome, FP-0270 simultaneous collision contract | `Shell.tsx`, `tokens.css`, `index.html` |
| QA, human research and release | ADR-0239, 0240, 0247; GP release gates | FP-0271 same-fixture Light/Dark pairs and signed denominator | `web/e2e/visual.e2e.ts`; candidates not verified goldens |

## Exact non-overlap decisions

- **FP-0264** does **not** replace SF-0201 contrast auditing; it requires an *edge-role / adjacent-light-surface taxonomy* with joint state tests.
- **FP-0265** does **not** re-add Light/Dark/System; it specifies **manual theme versus browser/PWA chrome precedence**.
- **FP-0266** does **not** create visualizers or new sound; it specifies cross-object **mid-session live theme repaint parity**.
- **FP-0267** does **not** create Library batch endpoints; they exist. It specifies **zero-selection contextual action visibility and focus**.
- **FP-0268** does **not** repeat GP-0259 truthful outcomes; it specifies a **compact default information budget** evaluated by task.
- **FP-0269** does **not** add navigation; it is a **per-state cross-route action-tier crosswalk**.
- **FP-0270** does **not** rebuild mobile shell; it adds **simultaneous keyboard/player/overlay collision precedence and geometric proof**.
- **FP-0271** does **not** duplicate screenshot tools; it specifies **same-fixture and same-viewport Light/Dark approval pairs with a denominator**.

## Non-negotiable parity

Original local music remains unchanged. Keep one audio owner and intentional Pause; stable song/seam identity and current-vs-draft revision; scoped Undo; explicit consent/atomic request bridges; all eight Studio lanes with supported variable cell count; truthful Library readiness and LRCLIB metadata disclosure; local privacy; blind listening neutrality; correct frozen-revision FLAC. Do not authorize SaaS, accounts, subscriptions, telemetry, cloud media sync or new backend/audio engine as a byproduct of polishing.

## Evidence boundary and acceptance process

Existing code is not independent human verification. The baseline source may already satisfy new acceptance tasks. Marking any FP task Implemented requires exact-source reconciliation (or new source PR/SHA) and linked tests. Verified requires independent named reviewer, dated actual outcomes and applicable real audio, AT, device and visual evidence. Do not total SF/GP/FP task counts as distinct missing product functionality.

[Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [JSON](selecta-final-polish-code-status.json) · [Parity](selecta-final-polish-overlap-and-parity.md) · [Verification](selecta-final-polish-verification-matrix.md) · [Reconciliation](selecta-final-polish-status-reconciliation.md) · [Release](selecta-final-polish-release-gates.md)
