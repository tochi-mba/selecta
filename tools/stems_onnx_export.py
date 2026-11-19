"""Export Demucs ``htdemucs`` to ONNX for the browser stem splitter (ADR-0459 Tier 3).

The browser runs this file with onnxruntime-web (``web/src/dsp/stems/runtime.ts``). The tensor
contract below is the one ``web/src/dsp/stems/adapter.ts`` reads; change both together:

    input  ``mix``    float32 [1, 2, S]     one stereo segment, normalised by the caller
    output ``stems``  float32 [1, 4, 2, S]  drums, bass, other, vocals (htdemucs source order)

where S is the fixed segment length, 7.8 s at 44.1 kHz = 343980 samples. The browser does the
chunking, overlap-add and normalisation that ``demucs.apply.apply_model`` does in Python.

Licence: the Demucs code is MIT, but the htdemucs weights' licence is not stated and they were
trained partly on research datasets (MUSDB18-HQ). The model is on licence status Review
(docs/saas/licence-register.md, ADR-0405 SC-0405-04). Do not publish the exported file to
members' browsers until docs/verification/bf-tier3-htdemucs-2026-11-19.md records a licence
PASS.

Known risk: htdemucs computes an STFT and inverse STFT inside ``forward`` with complex tensors.
The script uses the dynamo-based exporter, which handles more of that than the TorchScript
exporter; if export still fails, the route is to move the STFT/iSTFT out of the graph (inputs
become waveform plus spectrogram, outputs become the time and frequency branches) and update
``adapter.ts`` to match. The script reports the failure rather than writing a partial file.

Script only, run by hand on a machine with the ``demucs`` and ``onnx`` packages installed. It
must never run in tests or CI, so every heavy import happens inside ``main``:

    uv run --with demucs --with onnx --with onnxruntime python tools/stems_onnx_export.py \\
        --out build/stems/htdemucs.onnx [--fp16] [--check]
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from fractions import Fraction
from pathlib import Path

SAMPLE_RATE = 44100
SEGMENT = Fraction(39, 5)  # htdemucs's training segment, 7.8 s
SEGMENT_SAMPLES = int(SEGMENT * SAMPLE_RATE)
SOURCES = ("drums", "bass", "other", "vocals")
OPSET = 18


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True, help="where to write the .onnx file")
    parser.add_argument("--model", default="htdemucs", help="demucs pretrained model name")
    parser.add_argument(
        "--fp16", action="store_true", help="store weights as float16 (inputs stay float32)"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="run the exported file with onnxruntime against PyTorch on one random segment",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    import torch
    from demucs.pretrained import get_model

    bag = get_model(args.model)
    models = getattr(bag, "models", [bag])
    if len(models) != 1:
        print(f"{args.model} is a bag of {len(models)} models; export one model only.")
        return 2
    model = models[0].eval()
    if tuple(model.sources) != SOURCES or model.samplerate != SAMPLE_RATE:
        print(f"unexpected model: sources {model.sources}, sample rate {model.samplerate}")
        return 2
    if Fraction(model.segment) != SEGMENT:
        print(f"unexpected segment {model.segment}; the browser expects {SEGMENT}")
        return 2

    class Segment(torch.nn.Module):
        def __init__(self, inner: torch.nn.Module) -> None:
            super().__init__()
            self.inner = inner

        def forward(self, mix: torch.Tensor) -> torch.Tensor:
            return self.inner(mix)

    wrapper = Segment(model).eval()
    example = torch.zeros(1, 2, SEGMENT_SAMPLES)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with torch.no_grad():
            torch.onnx.export(
                wrapper,
                (example,),
                str(args.out),
                input_names=["mix"],
                output_names=["stems"],
                opset_version=OPSET,
                dynamo=True,
            )
    except Exception as problem:
        args.out.unlink(missing_ok=True)
        print(f"export failed: {problem}")
        print("see the module docstring: the STFT may need to move out of the graph")
        return 1

    if args.fp16:
        import onnx
        from onnxconverter_common import float16

        converted = float16.convert_float_to_float16(onnx.load(str(args.out)), keep_io_types=True)
        onnx.save(converted, str(args.out))

    if args.check:
        import numpy as np
        import onnxruntime

        rng = np.random.default_rng(0)
        mix = (rng.standard_normal((1, 2, SEGMENT_SAMPLES)) * 0.3).astype(np.float32)
        with torch.no_grad():
            reference = wrapper(torch.from_numpy(mix)).numpy()
        session = onnxruntime.InferenceSession(str(args.out), providers=["CPUExecutionProvider"])
        exported = session.run(["stems"], {"mix": mix})[0]
        if exported.shape != (1, len(SOURCES), 2, SEGMENT_SAMPLES):
            print(f"wrong output shape {exported.shape}")
            return 1
        difference = np.abs(exported - reference)
        print(f"max abs difference {difference.max():.6g}, mean {difference.mean():.6g}")

    print(f"file   {args.out}")
    print(f"bytes  {args.out.stat().st_size}")
    print(f"sha256 {sha256_of(args.out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
