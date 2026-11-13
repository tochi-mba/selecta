# Hosted-audio infrastructure inventory — read only

See docs/integration/lf18.md for the stage gates and operational safety model.

inventory.json maps current repository definitions to audio, mixed and retained
resources. The manifest is not a live cloud account inventory and contains no
secret values. Both audit and plan commands are read-only and provide no apply mode.

    python -m selecta.lf_fleet audit --root .
    python -m selecta.lf_fleet plan --root . --environment staging

Do not delete Modal apps, R2 objects, original backups, Terraform resources, Render
services, signing keys or DNS entries on the strength of this repository alone.
Legacy customer retrieval continues until the independent migration and legal gates
are completed. Mixed Render/Cloudflare resources contain essential control services.
