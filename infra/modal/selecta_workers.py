"""Selecta Cloud workers on Modal, EU region (ADR-0409). Deployed by `.github/workflows/deploy.yml`.

Workers never run on Render (its egress would make every upload to R2 expensive) and audio
never passes through the API or gateway: a worker downloads and uploads through signed R2 URLs
the gateway hands it. Each function runs `python -m selecta.workers.cloud`, which registers with
the gateway using the bootstrap token and serves until Modal stops it.

The image installs exactly the runtime closure of `uv.lock` plus the `observability` extra, so
`src/selecta/modes/licence_register.json` has a row for everything in it
(`tests/test_cloud_licence_register.py`). System tools installed here need a row there too.

Deploy: `modal deploy infra/modal/selecta_workers.py --env <staging|production>`. Secrets live
in Modal (`selecta-<env>-workers`): SELECTA_WORKER_GATEWAY_URL, SELECTA_WORKER_BOOTSTRAP_TOKEN,
SELECTA_WORKER_STORAGE_HOSTS, OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS.
This file is not imported by the test suite; `tests/test_cloud_infra.py` parses it.
"""

from __future__ import annotations

import os

import modal  # Only installed where Modal deploys run, never a Selecta dependency.

ENVIRONMENT = os.environ.get("SELECTA_ENVIRONMENT", "staging")
if ENVIRONMENT not in {"staging", "production"}:
    raise SystemExit("SELECTA_ENVIRONMENT must be staging or production.")
REGION = "eu"
"""Modal's EU region group; data stays in Europe (ADR-0409)."""

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("uv")
    .add_local_file("pyproject.toml", "/src/pyproject.toml", copy=True)
    .add_local_file("uv.lock", "/src/uv.lock", copy=True)
    .add_local_dir("src", "/src/src", copy=True)
    .run_commands(
        "cd /src && uv export --frozen --no-dev --extra observability --no-emit-project"
        " -o /tmp/requirements.txt",
        "uv pip install --system -r /tmp/requirements.txt",
        "uv pip install --system --no-deps /src",
    )
    .env({"SELECTA_MODE": "cloud", "SELECTA_ENVIRONMENT": ENVIRONMENT})
)

app = modal.App(f"selecta-workers-{ENVIRONMENT}", image=image)
secrets = [modal.Secret.from_name(f"selecta-{ENVIRONMENT}-workers")]

# Beta sizing from docs/saas/13-hosting-and-cost.md; scale to zero when idle.
CPU_LIGHT = {"cpu": 1.0, "memory": 2048, "max_containers": 4 if ENVIRONMENT == "staging" else 20}
CPU_HEAVY = {"cpu": 4.0, "memory": 8192, "max_containers": 2 if ENVIRONMENT == "staging" else 10}


def _serve(pool: str) -> None:
    os.environ["SELECTA_WORKER_POOL"] = pool
    from selecta.workers.cloud import main

    main()


@app.function(region=REGION, secrets=secrets, timeout=3600, min_containers=0, **CPU_LIGHT)
def cpu_light() -> None:
    """Playback proxies and other short CPU jobs."""
    _serve("cpu-light")


@app.function(region=REGION, secrets=secrets, timeout=3600, min_containers=0, **CPU_HEAVY)
def cpu_heavy() -> None:
    """Analysis and renders."""
    _serve("cpu-heavy")


@app.function(
    region=REGION, secrets=secrets, timeout=3600, min_containers=0, gpu="T4",
    max_containers=1 if ENVIRONMENT == "staging" else 4,
)
def gpu_stems() -> None:
    """Stem separation. Blocked until the Demucs weights row leaves Review (ADR-0405)."""
    _serve("gpu")
