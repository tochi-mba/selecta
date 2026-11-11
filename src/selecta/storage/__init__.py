"""Artifact storage, R2 access and uploads (ADR-0397, ADR-0398), and the deletions ledger.

- `keys`: where every stored file lives. Keys are built from ids only, never from file names.
- `artifacts`: `ArtifactStore`, with a local-folder implementation and an R2 one.
- `sigv4` and `r2`: a small S3 client for Cloudflare R2, signing requests by hand.
- `objects`: the client protocol, its results and its errors, so tests can use a fake.
- `uploads`: the browser upload protocol: plan, transfer, server-side completion, acceptance.
- `sandbox` and `audio_check`: validating an uploaded file in a limited child process.
- `parts` and `names`: the multipart part policy, and cleaning up what browsers send.
- `deletion`: tombstones that hide things at once and survive a database restore.
- `schema`: the `upload_sessions`, `assets` and `deletions` tables.

Nothing is imported here, so importing one module doesn't pull in the HTTP client or the tables.
"""
