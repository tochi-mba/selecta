# Glossary

The words we use, in the sense we use them. Music terms used in the app itself are explained in the site's own glossary (`web/src/ui/glossaryTerms.ts`).

| Term | Meaning |
|---|---|
| **ADR** | Architecture decision record: one decision, its reasons, and a numbered checklist of what proves it's done (`docs/adr/`). |
| **Artifact** | A file a job produced (a transition clip, stems, an export), stored under its attempt's prefix and recorded with how it was made. |
| **Attempt** | One try at running a job. Holds a lease and a fencing token. |
| **Core flag** | A flag that can't be switched off, because the product doesn't work without it. Core only in the modes it exists in. |
| **Deletion ledger** | The record of every deletion, replayed after a database restore so deleted data never comes back. |
| **Entitlement** | What a workspace's plan allows (storage, weight, allowances, features). Owned by billing; flags can't add to it. |
| **Fencing token** | A number that goes up with every claim of a job. A worker can publish only if its token is still the current one, so a late or duplicate worker can't overwrite newer work. |
| **Gateway** | The service workers talk to (`selecta gateway`). Workers never get database credentials. |
| **Kill switch** | A flag rule that turns a feature off for everyone at once, during an incident. |
| **Labs** | Where people switch beta features on for themselves, within what their plan includes. |
| **Lane** | How urgently a job competes in its pool: interactive (someone is waiting), standard, or speculative (spare time). |
| **Lease** | A worker's time-limited hold on an attempt, kept alive by heartbeats. When it lapses, the reaper gives the job back. |
| **Mode** | `local` (the original single-user app) or `cloud` (Selecta Cloud). Set by `SELECTA_MODE`. |
| **Outbox** | Rows written in the same transaction as a change, so events (SSE updates, notifications) are never lost or invented. |
| **Pool** | A kind of worker capacity: cpu-light, cpu-heavy, gpu, export. |
| **Port** | A small `Protocol` a package uses to ask another for something without importing it. Tests swap in fakes. |
| **Privileged session** | A staff member's admin session: fresh sign-in, MFA, at most an hour, built on the server. |
| **Reaper** | The maintenance task that returns jobs whose leases expired. |
| **Room** | A Premium host's party mode: guests scan a QR code and request songs; no audio goes to guests. |
| **Seam** | A transition between two songs, rendered by the engine. |
| **Speaker device** | The one device playing an account's music, holding the playback lease. Every other device is a remote. |
| **Virtual time** | The fair-share counter per account in a lane: it grows by work done divided by plan weight, and the smallest goes next. |
| **Workspace** | Who owns data. Today each person has one personal workspace; the schema allows teams later. |
