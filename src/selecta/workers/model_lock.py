"""Model weights pinned by SHA-256 for the Cloud worker image (ADR-0396 SC-0396-02).

`services/worker/models.lock.json` lists each model the image bakes in: where it comes from, where
it goes under the model root, its SHA-256 and its size. The image build runs `fetch`, which
downloads each file and refuses any whose hash or size differs; the container's entry point runs
`verify-then-run`, which checks every baked file again before starting the worker. Only models the
licence register allows in cloud mode may be listed (`selecta.modes.models`).

    python -m selecta.workers.model_lock fetch LOCK ROOT
    python -m selecta.workers.model_lock verify LOCK ROOT
    python -m selecta.workers.model_lock verify-then-run LOCK ROOT -- COMMAND...
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from selecta.modes.models import allowed_in_cloud

SHA256 = re.compile(r"[0-9a-f]{64}")
CHUNK = 1 << 20

Opener = Callable[[str], BinaryIO]


class ModelLockError(RuntimeError):
    """A lock entry is malformed, not allowed, or a file doesn't match its pin."""


@dataclass(frozen=True)
class PinnedModel:
    model_id: str
    url: str
    path: str
    sha256: str
    size: int


def parse_lock(data: dict) -> list[PinnedModel]:
    found: list[PinnedModel] = []
    for model_id, entry in data["models"].items():
        model = PinnedModel(model_id, str(entry["url"]), str(entry["path"]),
                            str(entry["sha256"]), int(entry["bytes"]))
        relative = PurePosixPath(model.path)
        problems = [
            why for bad, why in (
                (not allowed_in_cloud(model_id), "is not allowed in cloud mode by the licence "
                                                 "register"),
                (not model.url.startswith("https://"), "must download over https"),
                (not SHA256.fullmatch(model.sha256), "needs a full lower-case SHA-256"),
                (model.size <= 0, "needs its size in bytes"),
                (relative.is_absolute() or ".." in relative.parts, "path must stay under the "
                                                                   "model root"),
            ) if bad
        ]
        if problems:
            raise ModelLockError(f"{model_id}: {'; '.join(problems)}")
        found.append(model)
    return found


def load_lock(path: Path) -> list[PinnedModel]:
    return parse_lock(json.loads(Path(path).read_text("utf-8")))


def digest(path: Path) -> tuple[str, int]:
    hasher, size = hashlib.sha256(), 0
    with open(path, "rb") as handle:
        while chunk := handle.read(CHUNK):
            hasher.update(chunk)
            size += len(chunk)
    return hasher.hexdigest(), size


def check(model: PinnedModel, root: Path) -> None:
    target = Path(root) / model.path
    if not target.is_file():
        raise ModelLockError(f"{model.model_id}: {target} is missing")
    sha, size = digest(target)
    if (sha, size) != (model.sha256, model.size):
        raise ModelLockError(
            f"{model.model_id}: {target} is {size} bytes with SHA-256 {sha}, "
            f"pinned {model.size} bytes with {model.sha256}"
        )


def verify(models: Sequence[PinnedModel], root: Path) -> None:
    for model in models:
        check(model, root)


def _download(url: str) -> BinaryIO:
    return urllib.request.urlopen(url, timeout=120)  # noqa: S310 - https only, checked above


def fetch(models: Sequence[PinnedModel], root: Path, opener: Opener = _download) -> list[Path]:
    """Download each model to its place under `root`, keeping it only if it matches its pin."""
    written: list[Path] = []
    for model in models:
        target = Path(root) / model.path
        if target.is_file():
            check(model, root)
            written.append(target)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        hasher, size = hashlib.sha256(), 0
        handle, temporary = tempfile.mkstemp(dir=target.parent, prefix=".partial-")
        try:
            with os.fdopen(handle, "wb") as out, opener(model.url) as source:
                while chunk := source.read(CHUNK):
                    size += len(chunk)
                    if size > model.size:
                        raise ModelLockError(f"{model.model_id}: download is over {model.size} "
                                             "bytes")
                    hasher.update(chunk)
                    out.write(chunk)
            if (hasher.hexdigest(), size) != (model.sha256, model.size):
                raise ModelLockError(
                    f"{model.model_id}: downloaded {size} bytes with SHA-256 "
                    f"{hasher.hexdigest()}, pinned {model.size} bytes with {model.sha256}"
                )
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)
        written.append(target)
    return written


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 3 or args[0] not in {"fetch", "verify", "verify-then-run"}:
        print(__doc__, file=sys.stderr)
        return 2
    command, lock, root = args[0], Path(args[1]), Path(args[2])
    models = load_lock(lock)
    if command == "fetch":
        for path in fetch(models, root):
            print(f"pinned {path}")
        return 0
    verify(models, root)
    if command == "verify":
        return 0
    rest = args[3:]
    if rest[:1] == ["--"]:
        rest = rest[1:]
    if not rest:
        print("verify-then-run needs a command after --", file=sys.stderr)
        return 2
    os.execv(rest[0], rest)  # noqa: S606 - the image's own entry point
    return 0  # pragma: no cover - execv does not return


if __name__ == "__main__":
    raise SystemExit(main())
