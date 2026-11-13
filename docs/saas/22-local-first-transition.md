# Hosted-audio migration, infrastructure exit and commercial gate

**Accepted target:** 2026-11-13. **Implementation:** Not started. No services or customer files are changed by this documentation PR.

## Services to retire after safe cutover

Modal hosted CPU/GPU/export audio workers, worker gateway and claims, worker autoscaler/images, R2 originals/derived/exports/staging audio buckets, original-audio offsite backup, multipart uploads, quotas/reservations, server FLAC proxies, signed audio playback URLs, server-side analysis, stems, seams and export handlers, obsolete DSP spend dashboards.

## Services retained

Hosted control API, Postgres/RLS/Alembic, WorkOS identity, Stripe billing/reconciliation, approved hosted AI with token/cost guards, rooms/venues/command metadata, email, CDN/WAF, privacy-safe agent telemetry, non-audio DB backups and audit storage.

## Migration order

1. Inventory real versus synthetic customer music in production, signed URLs, object keys, backups, existing upload sessions, plan versions and protected mix virtual artifacts.

2. Obtain rights/contract/retention review for existing hosted customer files. Offer retrieval and local reattachment with appropriate notice and timing.

3. Introduce canonical track references, device-local bindings, immutable recipe schema and old asset-to-catalogue migration. Preserve unresolved references and historical mix versions.

4. Pair supported local agents, verify actual analysis/seam/export and 5/8 missing media repair, and migrate clients/plan copy to device-first UI.

5. Add new versioned plans without processing/storage quotas; keep old customer billing contracts reconciled and AI meter correctly bounded.

6. Stop new audio uploads through enforced admission control; retain approved temporary legacy retrieval only as needed.

7. Validate account metadata ZIP, local originals retention, account deletion, playback/offline, tenant isolation, backup restore and code rollback.

8. Decommission hosted DSP, gateway, audio R2 objects and backups after legal/data gate; revoke signing credentials and remove alert/deploy/job dependencies.

9. Prove no cloud path can again ingest/serve user audio even after disaster restore or an outdated client request.

## Rights and consent

A public-performance venue licence does not automatically permit all copies, distributed caches, stems, exports or music-source acquisition. Review UK copyright, music publishing/recording rights, territory, model weights, GPL installers, lyric APIs, consumer streaming terms and commercial venue contracts with specialists. Pilots and paid launch need separate sign-offs.

## Rollback

Before destructive media retirement, preserve tested metadata and legal retrieval migration paths. After a permitted irreversible R2 deletion, rollback may restore the control plane, not unavailable recordings or forbidden music upload endpoints. Never claim cloud account archive contains local audio.

## Financial assumptions

Replace R2 music-storage, Modal audio CPU/GPU and hosted render-ahead costs in forward unit economics with actual API/DB/AI costs, native install distribution, customer support, hardware certification, device diagnostics and site operations. Old numbers remain historical estimates, not future plan entitlements.

**Related:** [Service retirement](../adr/selecta-local-first-service-retirement.md) · [Data migration](../adr/selecta-local-first-data-migration.md) · [Release gates](../adr/selecta-local-first-release-gates.md).
