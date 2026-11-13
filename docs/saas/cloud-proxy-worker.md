# Cloud playback proxy worker

> **Accepted local-first target (2026-11-13; implementation not started).** Remote cloud audio proxy worker and R2 presigned media delivery are retirement targets, not the new design. Keep local decoding/provenance via installed engine; do not reuse remote worker gateway for audio. See ADR-0464 and ADR-0481. Historic architecture and evidence below remain part of the record. [Current direction](20-local-first-cloud-architecture.md) · [Migration](22-local-first-transition.md).


Run `python -m selecta.workers.cloud` in an environment with Selecta and ffmpeg installed.
Set `SELECTA_WORKER_GATEWAY_URL` and `SELECTA_WORKER_BOOTSTRAP_TOKEN` for enrollment.
The process enrolls in the CPU-light pool and claims only `play.proxy` jobs.

Optional settings include `SELECTA_FFMPEG`, `SELECTA_WORKER_ENGINE_VERSION`,
`SELECTA_WORKER_SCRATCH_MB`, `SELECTA_WORKER_SCRATCH_ROOT`, and
`SELECTA_WORKER_STORAGE_HOSTS`. Configure scratch, CPU and memory limits in the deployment;
the worker's advertised scratch capacity does not itself enforce a disk quota.

The handler verifies the original checksum, decodes to 24-bit FLAC at the declared sample rate,
and publishes the artifact through its fenced gateway attempt. It checks cancellation during
ffmpeg execution. No model weights are needed for this handler.

The browser requests preparation on Listen, polls for readiness and fetches the signed proxy URL.
Request generations prevent an old selection from starting after a newer selection. A failed
media load requests one fresh URL and restores the playhead and paused state.

This implementation still requires gateway/R2 end-to-end verification, deployment resource limits,
analysis-pipeline sample alignment, derived-budget eviction and mix-player integration before the
full playback ADR can be marked complete.
