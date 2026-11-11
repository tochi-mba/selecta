# Selecta Cloud worker image (ADR-0396 SC-0396-02, docs/saas/10-audio-engine-in-cloud.md).
# Build from the repository root:
#   docker build -f services/worker/Dockerfile -t selecta-worker .
# Linux, ffmpeg, CPU-only torch (the pytorch-cpu index pinned in pyproject.toml and uv.lock) and
# the model weights in services/worker/models.lock.json, each checked against its SHA-256 at
# build time so a changed upstream file fails the build instead of shipping. Workers hold no
# database or storage credentials: they talk to the worker gateway (SELECTA_WORKER_GATEWAY_URL)
# with a bootstrap token and touch storage only through signed URLs.

# The base is pinned by its multi-arch index digest (Docker Hub, read 2026-11-11) so a re-pushed
# tag can't change the image; bump the tag and the digest together.
FROM python:3.12.10-slim-bookworm@sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SELECTA_MODE=cloud \
    TORCH_HOME=/opt/models/torch \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev

COPY services/worker/models.lock.json /opt/models/models.lock.json
RUN /app/.venv/bin/python -m selecta.workers.model_lock fetch /opt/models/models.lock.json /opt/models

RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin selecta \
    && mkdir -p /scratch && chown selecta /scratch
ENV SELECTA_WORKER_SCRATCH_ROOT=/scratch \
    SELECTA_MODEL_LOCK=/opt/models/models.lock.json \
    SELECTA_MODEL_ROOT=/opt/models
USER selecta

# Refuse to start if a baked weight was changed after the build.
HEALTHCHECK NONE
ENTRYPOINT ["/app/.venv/bin/python", "-m", "selecta.workers.model_lock", "verify-then-run", \
            "/opt/models/models.lock.json", "/opt/models", "--", \
            "/app/.venv/bin/python", "-m", "selecta.workers.cloud"]
