"""Export Beat This (`small0`) to ONNX for the browser's beat source (ADR-0479 phase 5).

The Desktop tracks beats with Beat This (`src/selecta/analysis/beats.py::BeatTracker`, the
`small0` checkpoint, minimal postprocessing). The browser runs the same network with
onnxruntime-web (`web/src/dsp/analysis/beatThis/`); everything around it, the log-mel
spectrogram, the chunking and the peak picking, is ported to TypeScript. The tensor contract:

    input  ``spect``     float32 [1, T, 128]  log-mel frames, 50 per second, T from 1 to 1500
    output ``beat``      float32 [1, T]       beat logits (the SumHead's beat plus downbeat)
    output ``downbeat``  float32 [1, T]       downbeat logits

T is dynamic: the package runs a song in chunks of 1500 frames that overlap by 6, and a song
under 30 seconds as one shorter chunk, so the browser needs both. The TorchScript exporter
traces the rotary position embedding with a dynamic length; the dynamo exporter fails on this
model under torch 2.15, so it is not used.

The checkpoint is the one the package itself names (`beat_this.inference.CHECKPOINT_URL`); the
Desktop's own cached copy is used when present, else the package downloads it from that URL.
Weights and code are MIT (CPJKU). The exported file is never committed (this repo holds no
model weights): it is written under build/, and its hash, size and provenance go into
``web/src/dsp/analysis/beatThis/artefact.json``, which the browser verifies the download against.

Script only, run by hand where torch, beat_this, onnx and onnxruntime are installed:

    python tools/beat_this_onnx_export.py [--out build/beat-this] [--write-record]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "beat-this"
RECORD = ROOT / "web" / "src" / "dsp" / "analysis" / "beatThis" / "artefact.json"
CHECKPOINT = "small0"
IMPLEMENTATION = "web-beatthis-small0-1"
OPSET = 17
CHUNK = 1500
# ONNX logits against PyTorch's, absolute (docs/engineering/device-beats.md)
LOGIT_TOLERANCE = 1e-3
# lengths the browser sends: a full chunk, a short song's single chunk, and odd small ones
CHECK_LENGTHS = (1500, 1212, 1405, 600, 37, 1)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def checkpoint_path() -> Path:
    """The Desktop's cached checkpoint, fetched from the package's own URL when missing."""
    import torch
    from beat_this.inference import load_checkpoint

    cached = Path(torch.hub.get_dir()) / "checkpoints" / f"beat_this-{CHECKPOINT}.ckpt"
    if not cached.exists():
        load_checkpoint(CHECKPOINT)  # torch.hub download into the same cache
    return cached


def export(out: Path) -> dict:
    import numpy as np
    import onnx
    import onnxruntime
    import torch
    from beat_this.inference import CHECKPOINT_URL, load_model

    source = checkpoint_path()
    model = load_model(str(source), "cpu").eval()

    class Logits(torch.nn.Module):
        def __init__(self, net: torch.nn.Module) -> None:
            super().__init__()
            self.net = net

        def forward(self, spect):
            out = self.net(spect)
            return out["beat"], out["downbeat"]

    wrapped = Logits(model).eval()
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"beat-this-{CHECKPOINT}.onnx"
    example = torch.randn(1, CHUNK, 128, generator=torch.Generator().manual_seed(1)) + 1.0
    with torch.inference_mode():
        torch.onnx.export(
            wrapped,
            (example,),
            str(target),
            input_names=["spect"],
            output_names=["beat", "downbeat"],
            dynamic_axes={"spect": {1: "time"}, "beat": {1: "time"}, "downbeat": {1: "time"}},
            opset_version=OPSET,
            dynamo=False,
        )
    onnx.checker.check_model(str(target))

    session = onnxruntime.InferenceSession(str(target), providers=["CPUExecutionProvider"])
    generator = torch.Generator().manual_seed(7)
    worst = 0.0
    for length in CHECK_LENGTHS:
        # log-mel values sit between 0 and about 8; spread the inputs over that range
        spect = torch.rand(1, length, 128, generator=generator) * 7.0
        with torch.inference_mode():
            beat, downbeat = wrapped(spect)
        got_beat, got_downbeat = session.run(None, {"spect": spect.numpy()})
        diff = max(
            float(np.abs(got_beat - beat.numpy()).max()),
            float(np.abs(got_downbeat - downbeat.numpy()).max()),
        )
        print(f"T={length}: max abs logit difference {diff:.3g}")
        worst = max(worst, diff)
    if worst > LOGIT_TOLERANCE:
        target.unlink()
        raise SystemExit(f"ONNX logits differ from PyTorch by {worst}, over {LOGIT_TOLERANCE}")

    sha = sha256_of(target)
    return {
        "implementation": IMPLEMENTATION,
        "file": target.name,
        "sha256": sha,
        "bytes": target.stat().st_size,
        "path": f"/models/beat-this/{IMPLEMENTATION}/{sha}.onnx",
        "opset": OPSET,
        "dtype": "float32",
        "inputs": {"spect": "float32 [1, T, 128], T from 1 to 1500"},
        "outputs": {"beat": "float32 [1, T]", "downbeat": "float32 [1, T]"},
        "source": {
            "package": "beat-this 1.1.0 (https://github.com/CPJKU/beat_this)",
            "checkpoint": CHECKPOINT,
            "url": f"{CHECKPOINT_URL}/{CHECKPOINT}.ckpt",
            "sha256": sha256_of(source),
            "bytes": source.stat().st_size,
        },
        "licence": {
            "code": "MIT (CPJKU beat_this LICENSE, 2024 Institute of Computational Perception)",
            "weights": "MIT: the README releases the code and the published weights under MIT",
            "register": "docs/saas/licence-register.md (beat_this.small0)",
            "tier3Record": "docs/verification/bf-tier3-beat-this-2026-11-26.md",
        },
        "tools": {
            "torch": torch.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": onnxruntime.__version__,
        },
        "equivalence": {
            "lengths": list(CHECK_LENGTHS),
            "maxAbsLogit": worst,
            "tolerance": LOGIT_TOLERANCE,
        },
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--write-record", action="store_true", help=f"write {RECORD.name}")
    args = parser.parse_args(argv)
    record = export(args.out)
    text = json.dumps(record, indent=1) + "\n"
    print(text)
    if args.write_record:
        RECORD.parent.mkdir(parents=True, exist_ok=True)
        RECORD.write_text(text, encoding="utf-8", newline="\n")
        print(f"Wrote {RECORD}")
    elif RECORD.exists():
        committed = json.loads(RECORD.read_text(encoding="utf-8"))
        same = committed.get("sha256") == record["sha256"]
        print("matches the committed record" if same else "DIFFERS from the committed record")
        if not same:
            sys.exit(1)


if __name__ == "__main__":
    main()
