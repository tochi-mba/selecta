# Backup job image (ADR-0409 SC-0409-04, docs/saas/13-hosting-and-cost.md section 13.5).
# Runs the two nightly backup scripts as Render cron jobs (infra/backup/render-cron.yaml):
#   bash infra/backup/nightly_db_dump.sh   needs pg_dump/pg_restore 17 and the aws CLI
#   bash infra/backup/copy_originals.sh    needs rclone
# It carries no application code and no Selecta settings, only the backup scripts, so the cron
# jobs hold just the restricted backup credentials. Built on `main` by .github/workflows/deploy.yml.
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 awscli rclone \
    && apt-get purge -y gnupg curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 backup-job
WORKDIR /app
COPY infra/backup/ infra/backup/
USER backup-job
CMD ["bash", "-c", "echo 'Run a backup script: see infra/backup/render-cron.yaml' && exit 2"]
