"""The S-KEY network, trimmed to what inference needs.

Adapted from https://github.com/deezer/s-key (MIT, Copyright (c) 2019-present Deezer SA), which
includes ConvNeXt code originally from Meta FAIR. Module names are kept so the published
checkpoint loads unchanged. The checkpoint itself is not MIT: Deezer licenses the weights for
non-commercial research only, so they are downloaded to the user's machine and never kept in
this repo.
"""

from __future__ import annotations

import math

import nnAudio.features.vqt
import torch
import torchaudio
from einops import rearrange
from torch import nn

KEY_NAMES = (
    "A major", "Bb major", "B major", "C major", "C# major", "D major",
    "Eb major", "E major", "F major", "F# major", "G major", "Ab major",
    "B minor", "C minor", "C# minor", "D minor", "Eb minor", "E minor",
    "F minor", "F# minor", "G minor", "G# minor", "A minor", "Bb minor",
)  # fmt: skip


class VQT(nnAudio.features.vqt.VQT):
    def __init__(self, *, harmonics, fmin, n_bins, bins_per_octave=12, **kwargs):
        self.harmonics = harmonics
        self.bin_shifts = [round(bins_per_octave * math.log2(h)) for h in harmonics]
        self.n_bins_per_slice = n_bins
        self.fmin = fmin
        low_shift = min([0] + self.bin_shifts) / bins_per_octave
        fmin = fmin * (2**low_shift)
        n_bins = n_bins + max([0] + self.bin_shifts) - min([0] + self.bin_shifts)
        super().__init__(fmin=fmin, n_bins=n_bins, bins_per_octave=bins_per_octave, **kwargs)

    def forward(self, x, output_format="Magnitude", normalization_type="librosa"):
        vqt = super().forward(x, output_format, normalization_type)
        slices = []
        for shift in self.bin_shifts:
            start = shift - min([0] + self.bin_shifts)
            slices.append(vqt[:, start : start + self.n_bins_per_slice, ...])
        stacked = torch.stack(slices, dim=1)
        return (1.0 / 80.0) * torchaudio.transforms.AmplitudeToDB(top_db=80)(stacked) + 1.0


class ConvNeXtBlock(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size=7, padding=3):
        super().__init__()
        self.dwconv = nn.Conv2d(
            in_channels,
            out_channels,
            kernel_size=kernel_size,
            padding=padding,
            groups=in_channels,
            padding_mode="replicate",
        )
        self.pwconv1 = nn.Linear(out_channels, 4 * out_channels)
        self.act = nn.GELU()
        self.pwconv2 = nn.Linear(4 * out_channels, in_channels)
        self.gamma = nn.Parameter(torch.ones(out_channels))

    def forward(self, x):
        residual = x
        x = self.dwconv(x)
        x = nn.functional.layer_norm(x, x.shape[1:])
        x = x.permute(0, 2, 3, 1)
        x = self.pwconv2(self.act(self.pwconv1(x)))
        x = self.gamma * x
        return residual + x.permute(0, 3, 1, 2)


class TimeDownsamplingBlock(nn.Module):
    def __init__(self, in_channels, out_channels):
        super().__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size=(1, 2), stride=(1, 2))
        self.act = nn.GELU()

    def forward(self, x):
        x = nn.functional.layer_norm(x, x.shape[1:])
        return self.act(self.conv(x))


class ChromaNet(nn.Module):
    def __init__(self, n_harmonics, out_channels, kernels):
        super().__init__()
        in_channel = n_harmonics
        convnext, downsampling = [], []
        for out_channel, kernel in zip(out_channels, kernels, strict=True):
            downsampling.append(TimeDownsamplingBlock(in_channel, out_channel))
            convnext.append(ConvNeXtBlock(out_channel, out_channel, kernel, kernel // 2))
            in_channel = out_channel
        self.convnext_blocks = nn.ModuleList(convnext)
        self.time_downsampling_blocks = nn.ModuleList(downsampling)
        self.global_average_pool = nn.AdaptiveAvgPool2d((12, 1))
        self.classifier = nn.Conv2d(in_channel, 2, kernel_size=(1, 1))
        self.batch_norm = nn.BatchNorm2d(2, affine=False)

    def forward(self, x):
        for block, downsample in zip(
            self.convnext_blocks, self.time_downsampling_blocks, strict=True
        ):
            x = block(downsample(x))
        x = rearrange(x, "B C (j k) W -> B C k j W", k=12).mean(dim=3)
        x = self.classifier(self.global_average_pool(x))
        x = self.batch_norm(x).flatten(1)
        return torch.softmax(x, dim=-1)
