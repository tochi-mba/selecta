# LF hosted-audio service retirement and remaining cloud inventory

**Status:** Accepted target, not deployed or started. **Owner:** LF-0481. Removing spend without destroying user data requires explicit cutover gates.

## Retire when verified

| Existing deploy/service | Exact source | Reason | Prerequisite |
|---|---|---|---|
| Modal CPU and GPU DSP functions | `infra/modal/selecta_workers.py` | Processing happens locally | Local DSP parity and no-cloud-audio tests |
| Hosted CPU/GPU/export worker image | `services/worker/Dockerfile` | No remote analysis, stems or renders | Local package and model rights reviewed |
| Worker gateway and claim/heartbeat/complete transport | `src/selecta/work/gateway_api.py`, `src/selecta/gateway_cloud.py` | No remote audio work | New outbound *device-control* channel stable |
| Worker autoscaler/capacity files | `src/selecta/work/autoscale*.py`, `infra/workers/pools.json` | No hosted DSP fleet | Remove worker metric/queue dependencies |
| R2 user originals bucket | `infra/r2/lifecycle.tf.json` | No hosted music | Media retrieval, legal retention, backup-drill gate |
| R2 derived/stems/proxies/seams bucket | same | Derived audio stays local | No product/recipe reference stranded |
| R2 exports bucket | same | Export only on local host | Historical customer export access resolved |
| R2 staging bucket and multipart reservations | `src/selecta/storage/uploads.py` | No audio uploads | Uploaded sessions closed/aborted |
| Original-audio offsite backups | `infra/backup/copy_originals.sh` | No originals to back up | Retention and tombstone validation |
| Presigned original/derived playback APIs | `src/selecta/storage/playback_api.py`, `src/selecta/routes/cloud_proxy.py` | Local media binding | All clients migrated, deny-path tests |
| Cloud render, analyse and proxy handlers | `src/selecta/workers/*handlers.py` | No hosted audio decoder | Same actual DSP works on device |
| Cloud storage/read quota and CPU fair scheduler | `src/selecta/usage/`, `src/selecta/scheduling/` | New plan no longer meters local DSP | Versioned plan migration |

## Keep

Cloud web/CDN/WAF; authenticated API on Render (or later host); PostgreSQL/RLS/Alembic; WorkOS identity; Stripe billing/reconciliation; permitted hosted AI gateway and cost metering; email; room/request metadata; business scheduling and device commands; privacy-safe cloud observability; non-audio DB backups, audit archives and optional venue logos. Keep cloud maintenance for identity/billing, plan versions, command journal, retention and device state, while dropping media-object GC.

## Explicit service cutover

1. Determine whether actual user audio exists; do not assume a development-only environment.
2. Close **new** audio admission under an enforced API boundary, while maintaining authorised retrieval of existing uploads for the approved transition window.
3. Provide users a clearly explained local-media reattach workflow and prove historical mix recipes resolve after migration.
4. Verify backups, legal holds and deletion ledger. Do not delete the backup replication machinery before purge is complete.
5. Shut down workers, gateway and audio buckets; revoke signing and storage credentials; clean deployments, DNS, WAF routes, secrets, alerts, runbooks and billing assumptions.
6. Verify production cloud has no audio ingress/egress endpoint, no active user-audio objects and no way for an old client to restore legacy media routes.
7. Keep database and authenticated cloud-control restore tests green after teardown. Confirm estimated recurring costs actually fall.

## Services that might still use object storage

Cloud storage for DB backup, audit or consented venue logos is not an audio locker. Keep separate bucket names, content allowlists, retention and restricted operators. No generic bucket should silently accept WAV/MP3/FLAC/stem payloads.

## Rollback limit

Before customer audio is purged, a reversible cutover may restore an approved retrieval path while still preventing new cloud audio uploads. After irreversible purge, rollback can restore control-plane code and metadata only; it must not re-create a hosted audio product or falsely promise restoration of unavailable recordings.
