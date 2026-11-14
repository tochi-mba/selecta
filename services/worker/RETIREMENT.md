# Hosted DSP worker retirement — source-only, no remote deletion

PR64 Agent 09 has disabled worker entrypoints and removed the Modal deployment
step from the release script. This does **not** delete or scale down any live
Modal app, remove its historical credentials, or clean its R2 inputs/outputs.

The historical Dockerfile, model lock, licence data and standalone DSP
implementation are retained for developer-data recovery, reproducibility and
an audited teardown. No new Cloud job may fetch, decode, analyse, separate stems
or render a user's recording. For browser Cloud the work executes on the
authorised device, not in this worker.

Before manual retirement: check GitHub/Render/Modal/R2 live inventory using
read-only tools; confirm no pending developer jobs, legitimate source records,
backups or retention obligations; record last signed-URL expiry; verify the
Cloud egress capture and endpoint regression suite; obtain separate approval;
then scale down/revoke only the isolated hosted-media resources. Do not run
`tofu destroy` or remove buckets from the active Terraform state automatically.
