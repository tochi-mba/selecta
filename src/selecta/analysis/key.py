"""Musical key: S-KEY first, with a template match on chroma as a second opinion.

Fifth and relative-key errors are common and still usually mixable, so the two methods agreeing
at that level counts as agreement. Key is a soft signal in Selecta either way: blends get
rejected on measured roughness, not on this label.
"""

from __future__ import annotations

import hashlib
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SKEY_COMMIT = "80d9590e150b836a341dfc6dbf05aa20bc81d10b"
SKEY_URL = f"https://raw.githubusercontent.com/deezer/s-key/{SKEY_COMMIT}/skey/models/skey.pt"
SKEY_SHA256 = "78dfd0ad4fa9434bf7cec70a25934b7c575bda9c80e994700140770ad3a5ead4"

_PITCH = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6,
    "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
}  # fmt: skip
_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")

_CAMELOT_MAJOR = {0: 8, 7: 9, 2: 10, 9: 11, 4: 12, 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7}
_CAMELOT_MINOR = {9: 8, 4: 9, 11: 10, 6: 11, 1: 12, 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7}

_KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass
class KeyResult:
    name: str
    camelot: str
    confidence: float
    agrees_with_chroma: bool
    chroma_name: str


def parse_key(name: str) -> tuple[int, bool]:
    note, mode = name.split()
    return _PITCH[note], mode.lower() == "major"


def camelot(name: str) -> str:
    pitch, major = parse_key(name)
    return f"{_CAMELOT_MAJOR[pitch]}B" if major else f"{_CAMELOT_MINOR[pitch]}A"


def tonic_of_camelot(code: str) -> tuple[int, bool]:
    """The pitch class of a Camelot code's tonic, and whether it's major."""
    number, letter = int(code[:-1]), code[-1]
    table = _CAMELOT_MAJOR if letter == "B" else _CAMELOT_MINOR
    pitch = next(p for p, n in table.items() if n == number)
    return pitch, letter == "B"


def camelot_distance(a: str, b: str) -> int:
    """Steps around the wheel, plus one for a major/minor switch."""
    number_a, letter_a = int(a[:-1]), a[-1]
    number_b, letter_b = int(b[:-1]), b[-1]
    around = abs(number_a - number_b)
    return min(around, 12 - around) + int(letter_a != letter_b)


def chroma_key(chroma_profile: np.ndarray) -> str:
    """Krumhansl-Schmuckler template match on an averaged 12-bin chroma."""
    profile = chroma_profile - chroma_profile.mean()
    best_score, best_name = -np.inf, "C major"
    for tonic in range(12):
        for template, label in ((_KS_MAJOR, "major"), (_KS_MINOR, "minor")):
            shifted = np.roll(template - template.mean(), tonic)
            score = float(np.dot(profile, shifted))
            if score > best_score:
                best_score, best_name = score, f"{_NAMES[tonic]} {label}"
    return best_name


def keys_compatible(a: str, b: str) -> bool:
    return camelot_distance(camelot(a), camelot(b)) <= 1


class KeyDetector:
    """S-KEY, downloaded once to the models folder and checked against a pinned hash."""

    def __init__(self, models_dir: Path):
        from selecta.modes.models import require_model

        require_model("skey")
        import torch

        from selecta.analysis.skey_model import VQT, ChromaNet

        self._torch = torch
        checkpoint = _load_checkpoint(_ensure_weights(models_dir), torch)
        self.sample_rate = int(checkpoint["audio"]["sr"])
        self.hcqt = VQT(harmonics=[1], fmin=27.5, n_bins=99)
        self.net = ChromaNet(
            n_harmonics=1,
            out_channels=[2, 3, 40, 40, 30, 10, 3],
            kernels=[7, 7, 7, 7, 7, 5, 5],
        )
        stone = checkpoint["stone"]
        self.hcqt.load_state_dict(
            {k.replace("hcqt.", ""): v for k, v in stone.items() if "hcqt" in k}
        )
        self.net.load_state_dict(
            {k.replace("chromanet.", ""): v for k, v in stone.items() if "chromanet" in k},
            strict=False,
        )
        self.hcqt.eval()
        self.net.eval()

    def detect(self, mono: np.ndarray, sample_rate: int, chroma_profile: np.ndarray) -> KeyResult:
        from selecta.analysis.skey_model import KEY_NAMES

        torch = self._torch
        if sample_rate != self.sample_rate:
            raise ValueError(f"S-KEY needs {self.sample_rate} Hz, got {sample_rate}")
        peak = float(np.max(np.abs(mono))) or 1.0
        batch = torch.from_numpy(mono / peak).float().reshape(1, 1, -1)
        with torch.inference_mode():
            spectrogram = self.hcqt(batch)[:, :, :84, :]
            probabilities = self.net(spectrogram).mean(dim=0).numpy()
        ranked = np.argsort(probabilities)[::-1]
        name = KEY_NAMES[int(ranked[0])]
        margin = float(probabilities[ranked[0]] - probabilities[ranked[1]])
        second_opinion = chroma_key(chroma_profile)
        agrees = keys_compatible(name, second_opinion)
        confidence = float(np.clip(margin * 2.0 + (0.25 if agrees else 0.0), 0.0, 1.0))
        return KeyResult(name, camelot(name), confidence, agrees, second_opinion)


def _ensure_weights(models_dir: Path) -> Path:
    path = models_dir / "skey.pt"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".download")
        urllib.request.urlretrieve(SKEY_URL, temporary)
        temporary.replace(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SKEY_SHA256:
        path.unlink(missing_ok=True)
        raise RuntimeError("S-KEY weights failed their hash check and were removed. Try again.")
    return path


def _load_checkpoint(path: Path, torch) -> dict:
    """Load with weights_only, allowing just the harmless numpy helpers this file references."""
    import codecs

    allowed = [
        (np._core.multiarray.scalar, "numpy.core.multiarray.scalar"),
        np.dtype,
        (codecs.encode, "_codecs.encode"),
    ]
    allowed += [type(np.dtype(t)) for t in ("float64", "float32", "int64", "int32")]
    with torch.serialization.safe_globals(allowed):
        return torch.load(path, map_location="cpu", weights_only=True)
