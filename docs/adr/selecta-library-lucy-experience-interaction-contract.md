# Selecta - LX Library / Lucy interaction and art-direction contract

**Status:** 26 Proposed ADRs (0340–0365); 208 LX tasks Not started; 0 In progress; 0 Implemented; 0 independently Verified. Owner unassigned. Baseline `main` `da942863e9f57e45653cfc2fda35fe463477b8be` (2026-11-08). Documentation only.

## First principles

- **Music first:** Visual identity of actual tracks, exact order and transitions outrank AI decoration and management chrome. The assistant is a co-creator, not a second player.
- **Readable hierarchy:** One relevant primary action per context, clear secondary disclosure, persistent meaningful state and accessible names; never use colour alone for truth.
- **Trusted provenance:** Artwork only if actually sourced and permissioned, otherwise Selecta music motifs; unknown BPM/key/energy is unknown; suggestion is not a built mix; historical seam success is not a verified on-disk playable clip.
- **Existing semantics first:** The same source song, read-only planning proposal, ready-only directed seam and server-authoritative draft must appear consistently in Library, Make a Mix and Lucy.

## Library experience contract

| State | First visible information | Primary action | Secondary disclosure | Must not happen |
|---|---|---|---|---|
| Collection normal | Library name, search, useful true counts, filters, results | Search/open exact recording | View/density and advanced filtering | Fake counts or hidden search |
| Ready recording | Title, artist, BPM/key/duration and ready status | Context-appropriate Start mix or Add | Play next/priority/exclusion | Autoplay or wrong mix replacement |
| Not analysed | Unknown measurements and actual queue state | Analyse, when allowed | Detail/reason | Label BPM present based solely on guess |
| Missing/error | Known reason and clear scope | Supported retry/recover | Advanced info | Claim original file was moved/deleted |
| Selection mode | Selected of loaded, limit 200, exact IDs | Valid selected action | More batch options | Treat filtered universe as selected |
| 20k browsing | Stable ID, current results and depth | Continue retrieval | Collection/list | Eager DOM of whole library or focus theft |

## Lucy / Make a Mix experience contract

| State | Visible object | Primary action | Secondary action | Must not happen |
|---|---|---|---|---|
| Make a Mix front door | Quick Mix and Create with Lucy as understandable alternatives | Quick Play or enter Lucy | Mood/shaping | Mandatory AI, automatic Lucy send |
| Lucy empty | Conversation prompt with example intents | Write/send request | History/settings | Generate mix from a normal question |
| Lucy working | Current user request and meaningful live steps | Stop or await completion | Tool evidence | Fake progress or hidden permissions |
| Proposal | Exact current revision, songs, ready K−1 edges and hard rules | Revise or Save as draft | Compare, Ask about song/seam | Call not-built work 'playing' |
| Strict ready-only blocked | Actual missing/incompatible edges | Choose smaller/relaxed route explicitly | Explain feasibility | Silent rendering / rule relaxation |
| Save draft | Exact approval, preflight and scoped current revision | Confirm save | Cancel | Stop/restart music |
| Save and play | Exact revision, what will be replaced, explicit assent | Confirm save and play | Save as draft instead | Assistant-controlled play |
| Offline/unknown | Persistent conversation state and truth about last confirmed commit | Catch up/reconcile | Provider fallback | Duplicate commit or false success |

## Responsive and visual rules

- **Desktop:** Conversation + proposal split only where both fit; history is optional. **Mobile:** Chat/Your mix as keyboard-accessible tabs and status summary; composer above player and keyboard with no clipped confirmation.
- Use established Selecta Light/Dark/System semantic tokens, typographic scale and intentional density; no detached purple chatbot theme. Maintain a visibly different focus treatment.
- 320px/400% reflow, 200% zoom, short landscape, force colours, RTL/CJK, coarse touch and keyboard navigation are first-class acceptance states.
- Motion must map to real input, actual progress or verified audio; Still and reduced motion preserve status in text. Never add unsolicited interface sounds or beat-like animation disconnected from real audio.
- Avoid global CSS overrides or redesign outside Library/Make a Mix/Lucy; prefer scoped component styles and documented ownership.

## Research posture

These are proposals and user-study hypotheses, not proof from mockups. Use matched baseline screenshots, actual state data, qualitative novice/expert work, real audio and accessibility testing before declaring polish complete. Refer to [verification matrix](selecta-library-lucy-experience-verification-matrix.md) and [release gates](selecta-library-lucy-experience-release-gates.md).
