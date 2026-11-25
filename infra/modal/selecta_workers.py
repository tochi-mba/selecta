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
MODEL_ROOT = "/opt/models"
MODEL_LOCK = f"{MODEL_ROOT}/models.lock.json"
"""Weights baked into the image, pinned in services/worker/models.lock.json (ADR-0396)."""

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("uv")
    .add_local_file("pyproject.toml", "/src/pyproject.toml", copy=True)
    .add_local_file("uv.lock", "/src/uv.lock", copy=True)
    .add_local_file("README.md", "/src/README.md", copy=True)  # the package build reads it
    .add_local_dir("src", "/src/src", copy=True)
    .add_local_file("services/worker/models.lock.json", MODEL_LOCK, copy=True)
    .run_commands(
        "cd /src && uv export --frozen --no-dev --extra observability --no-emit-project"
        " -o /tmp/requirements.txt",
        # The lock pins torch to PyTorch's CPU builds, which live on PyTorch's own index
        # (pyproject's pytorch-cpu), as infra/docker/service.Dockerfile does.
        "uv pip install --system --extra-index-url https://download.pytorch.org/whl/cpu"
        " --index-strategy unsafe-best-match -r /tmp/requirements.txt",
        "uv pip install --system --no-deps /src",
        # The beat model is baked in at build time, checked against its SHA-256 in the lock,
        # where torch looks for it (TORCH_HOME below), so no container downloads it from the
        # model's university server on its first analysis (services/worker/Dockerfile does
        # the same). A changed or unreachable file fails the build, never an analysis.
        f"python -m selecta.workers.model_lock fetch {MODEL_LOCK} {MODEL_ROOT}",
    )
    .env({"SELECTA_MODE": "cloud", "SELECTA_ENVIRONMENT": ENVIRONMENT,
          "TORCH_HOME": f"{MODEL_ROOT}/torch"})
)

app = modal.App(f"selecta-workers-{ENVIRONMENT}", image=image)
secrets = [modal.Secret.from_name(f"selecta-{ENVIRONMENT}-workers")]

# Beta sizing from docs/saas/13-hosting-and-cost.md; scale to zero when idle.
CPU_LIGHT = {"cpu": 1.0, "memory": 2048, "max_containers": 4 if ENVIRONMENT == "staging" else 20}
CPU_HEAVY = {"cpu": 4.0, "memory": 8192, "max_containers": 2 if ENVIRONMENT == "staging" else 10}
GPU_FALLBACK = {"cpu": 8.0, "memory": 16384, "max_containers": 1 if ENVIRONMENT == "staging" else 4}
EXPORT = {"cpu": 4.0, "memory": 8192, "max_containers": 2 if ENVIRONMENT == "staging" else 8}
# Function names are the ones `selecta.work.autoscale_leader.MODAL_FUNCTIONS` scales
# (pool -> function, fallback function); tests/test_cloud_infra.py checks the two agree.


def _serve(pool: str) -> None:
    os.environ["SELECTA_WORKER_POOL"] = pool
    from pathlib import Path

    from selecta.workers import model_lock
    from selecta.workers.cloud import main

    # every baked file checked again before the worker takes a job, as the Dockerfile's entry
    # point does (`verify-then-run`)
    model_lock.verify(model_lock.load_lock(Path(MODEL_LOCK)), Path(MODEL_ROOT))
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


@app.function(region=REGION, secrets=secrets, timeout=3600, min_containers=0, **GPU_FALLBACK)
def gpu_stems_fallback() -> None:
    """The gpu pool's CPU fallback when Modal has no GPU capacity: the same jobs, slower."""
    _serve("gpu")


@app.function(region=REGION, secrets=secrets, timeout=3600, min_containers=0, **EXPORT)
def export() -> None:
    """Full-mix export renders."""
    _serve("export")
