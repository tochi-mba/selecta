# Selecta Cloud API, worker gateway and maintenance service image (ADR-0409).
# Built on `main` by .github/workflows/deploy.yml and pushed to GHCR; Render runs it.
# Installs exactly the locked runtime closure plus the observability extra, the same set the
# licence register covers (src/selecta/modes/licence_register.json).
FROM python:3.12-slim-bookworm
RUN pip install --no-cache-dir uv==0.12.15
WORKDIR /app
COPY pyproject.toml uv.lock ./
# The lock pins torch and torchaudio to PyTorch's CPU builds (pyproject's pytorch-cpu index), which
# PyPI doesn't serve, and an exported requirements file doesn't carry that index. The exported
# hashes still pin every file exactly, so looking at both indexes can't pick anything unlocked.
RUN uv export --frozen --no-dev --extra observability --no-emit-project -o /tmp/requirements.txt \
    && uv pip install --system --no-cache \
        --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
        -r /tmp/requirements.txt
COPY src ./src
RUN uv pip install --system --no-cache --no-deps . \
    && useradd --create-home --uid 10001 selecta
USER selecta
ENV SELECTA_MODE=cloud PYTHONUNBUFFERED=1
# Render sets the command per service: `selecta web --no-open --port 10000`,
# `selecta gateway --port 10000` or `selecta maintain`.
CMD ["selecta", "web", "--no-open", "--port", "10000"]
