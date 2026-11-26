"""Write the shared audio id fixtures: tiny synthetic files and the ids they must have.

    python tools/audio_identity_fixtures.py

Every file is built from bytes here: a valid container around made-up payload bytes, no real
music and no encoder, because the rules (docs/engineering/audio-identity.md) are about
containers. Files whose name shares a group (`mp3-a-...`) hold the same payload in different
wrappings and must share one id. The expected id is the SHA-256 of the payload this script
embedded, worked out here independently and checked against `selecta.library.audio_identity`
before the manifest is written, so the manifest is never just "whatever the code said".

Both test suites read `tests/fixtures/audio_identity/manifest.json` and these files: Python in
`tests/test_audio_identity.py`, the browser in `web/src/media/audioIdentity.test.ts`.
"""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures" / "audio_identity"
sys.path.insert(0, str(ROOT / "src"))

from selecta.library.audio_identity import audio_id  # noqa: E402


def noise(label: str, count: int) -> bytes:
    """Made-up bytes, the same every run, with no 0xFF so no stray frame sync appears."""
    out = b""
    counter = 0
    while len(out) < count:
        out += hashlib.sha256(f"{label}:{counter}".encode()).digest()
        counter += 1
    return bytes(byte if byte != 0xFF else 0x7F for byte in out[:count])


def expected(payload: bytes) -> str:
    return "a1:" + hashlib.sha256(payload).hexdigest()


def syncsafe(value: int) -> bytes:
    return bytes([(value >> 21) & 0x7F, (value >> 14) & 0x7F, (value >> 7) & 0x7F, value & 0x7F])


def id3v2(title: str, padding: int, version: int = 3, art: bytes = b"", footer: bool = False):
    frame_id = b"TIT2"
    text = b"\x00" + title.encode()
    size = syncsafe(len(text)) if version == 4 else len(text).to_bytes(4, "big")
    body = frame_id + size + b"\x00\x00" + text
    if art:
        picture = b"\x00image/png\x00\x03\x00" + art
        size = syncsafe(len(picture)) if version == 4 else len(picture).to_bytes(4, "big")
        body += b"APIC" + size + b"\x00\x00" + picture
    body += b"\x00" * padding
    flags = 0x10 if footer else 0
    head = bytes([version, 0, flags]) + syncsafe(len(body))
    return b"ID3" + head + body + (b"3DI" + head if footer else b"")


def id3v1(title: str) -> bytes:
    return (b"TAG" + title.encode().ljust(30, b"\x00")).ljust(128, b"\x00")


def apev2(text: str, header: bool = True, version: int = 2000) -> bytes:
    items = len(text).to_bytes(4, "little") + b"\x00" * 4 + b"Title\x00" + text.encode()
    size = len(items) + 32
    flags = 0x80000000 if header else 0
    common = version.to_bytes(4, "little") + size.to_bytes(4, "little")
    common += (1).to_bytes(4, "little")
    footer = b"APETAGEX" + common + flags.to_bytes(4, "little") + b"\x00" * 8
    head = b"APETAGEX" + common + (flags | 0x20000000).to_bytes(4, "little") + b"\x00" * 8
    return (head if header else b"") + items + footer


def lyrics3v2(text: str) -> bytes:
    body = b"LYRICSBEGIN" + b"IND00002" + b"10" + b"LYR" + f"{len(text):05d}".encode()
    body += text.encode()
    return body + f"{len(body):06d}".encode() + b"LYRICS200"


# ---- MP3 ------------------------------------------------------------------------------------

MP3_A = b"\xff\xfb\x90\x64" + noise("mp3-a", 400)


def mp3_files() -> list[tuple[str, str | None, bytes, str | None]]:
    a = MP3_A
    junk = bytes([0x11, 0x22, 0x33]) * 5
    return [
        ("mp3-a-bare.mp3", "mp3-a", a, expected(a)),
        ("mp3-a-id3.mp3", "mp3-a", id3v2("First title", 16) + a, expected(a)),
        ("mp3-a-retitled.mp3", "mp3-a", id3v2("A second title", 300) + a, expected(a)),
        (
            "mp3-a-artwork.mp3",
            "mp3-a",
            id3v2("First title", 0, 4, art=noise("art", 200)) + a + id3v1("First title"),
            expected(a),
        ),
        (
            "mp3-a-every-tag.mp3",
            "mp3-a",
            id3v2("One", 8)
            + id3v2("Two", 4, 4)
            + b"\x00" * 37
            + a
            + apev2("Ape")
            + lyrics3v2("la la")
            + id3v1("Old"),
            expected(a),
        ),
        ("mp3-a-junk-before.mp3", "mp3-a", id3v2("Junk", 2) + junk + a, expected(a)),
        (
            "mp3-a-appended-id3.mp3",
            "mp3-a",
            a + apev2("No header", header=False) + id3v2("End", 5, 4, footer=True) + id3v1("x"),
            expected(a),
        ),
        ("mp3-bad-tag-too-long.mp3", None, b"ID3\x03\x00\x00\x00\x00\x7f\x7f" + a, None),
        ("mp3-bad-no-frame.mp3", None, id3v2("Silence", 40) + b"\x00" * 300, None),
        ("mp3-bad-lyrics3v1.mp3", None, a + b"LYRICSBEGINwordsLYRICSEND", None),
        ("mp3-bad-ape-version.mp3", None, a + apev2("x", version=3000), None),
        ("mp3-bad-not-audio.mp3", None, b"\x00\x01" + a, None),
    ]


# ---- FLAC -----------------------------------------------------------------------------------

FLAC_A = b"\xff\xf8" + noise("flac-a", 400)


def block(kind: int, data: bytes, last: bool = False) -> bytes:
    return bytes([kind | (0x80 if last else 0)]) + len(data).to_bytes(3, "big") + data


def flac_files() -> list[tuple[str, str | None, bytes, str | None]]:
    a = FLAC_A
    info = noise("streaminfo", 34)
    comment = block(4, b"title=one")
    bare = b"fLaC" + block(0, info, last=True) + a
    tagged = b"fLaC" + block(0, info) + comment + block(1, b"\x00" * 50, last=True) + a
    retitled = (
        b"fLaC"
        + block(0, info)
        + block(4, b"title=a longer title")
        + block(1, b"\x00" * 9, last=True)
    )
    art = b"fLaC" + block(0, info) + comment + block(6, noise("pic", 120), last=True) + a
    return [
        ("flac-a-bare.flac", "flac-a", bare, expected(a)),
        ("flac-a-tagged.flac", "flac-a", tagged, expected(a)),
        ("flac-a-retitled.flac", "flac-a", retitled + a, expected(a)),
        ("flac-a-artwork.flac", "flac-a", art, expected(a)),
        ("flac-a-id3-around.flac", "flac-a", id3v2("x", 4) + tagged + id3v1("x"), expected(a)),
        ("flac-bad-first-block.flac", None, b"fLaC" + comment + block(0, info, True) + a, None),
        ("flac-bad-no-sync.flac", None, b"fLaC" + block(0, info, last=True) + b"\x00" + a, None),
        ("flac-bad-block-too-long.flac", None, b"fLaC" + block(0, info)[:4] + info[:10], None),
    ]


# ---- MP4 ------------------------------------------------------------------------------------

MP4_A = noise("mp4-a", 500)


def box(kind: bytes, data: bytes) -> bytes:
    return (8 + len(data)).to_bytes(4, "big") + kind + data


def mp4_files() -> list[tuple[str, str | None, bytes, str | None]]:
    a = MP4_A
    ftyp = box(b"ftyp", b"M4A \x00\x00\x00\x00M4A mp42isom")
    moov = box(b"moov", box(b"mvhd", noise("mvhd", 40)) + box(b"udta", b"title one"))
    moov2 = box(b"moov", box(b"mvhd", noise("mvhd", 40)) + box(b"udta", b"title two!" * 9))
    large = (1).to_bytes(4, "big") + b"mdat" + (16 + len(a)).to_bytes(8, "big") + a
    return [
        ("mp4-a-moov-first.m4a", "mp4-a", ftyp + moov + box(b"mdat", a), expected(a)),
        (
            "mp4-a-mdat-first.m4a",
            "mp4-a",
            ftyp + box(b"free", b"\x00" * 20) + box(b"mdat", a) + moov2,
            expected(a),
        ),
        ("mp4-a-large-size.m4a", "mp4-a", ftyp + moov2 + large, expected(a)),
        (
            "mp4-a-to-end.m4a",
            "mp4-a",
            ftyp + moov + (0).to_bytes(4, "big") + b"mdat" + a,
            expected(a),
        ),
        (
            "mp4-a-split.m4b",
            "mp4-a",
            ftyp + box(b"mdat", a[:123]) + moov + box(b"mdat", a[123:]),
            expected(a),
        ),
        ("mp4-bad-no-mdat.m4a", None, ftyp + moov, None),
        ("mp4-bad-box-too-long.m4a", None, ftyp + moov + box(b"mdat", a)[:-5], None),
        ("mp4-bad-tiny-size.m4a", None, ftyp + (4).to_bytes(4, "big") + b"mdat" + a, None),
    ]


# ---- WAV, RF64, AIFF ------------------------------------------------------------------------

WAV_A = noise("wav-a", 400)
AIFF_A = noise("aiff-a", 400)


def chunk(kind: bytes, data: bytes, big: bool = False) -> bytes:
    size = len(data).to_bytes(4, "big" if big else "little")
    return kind + size + data + (b"\x00" if len(data) % 2 else b"")


def riff(chunks: bytes) -> bytes:
    return b"RIFF" + (4 + len(chunks)).to_bytes(4, "little") + b"WAVE" + chunks


def wav_files() -> list[tuple[str, str | None, bytes, str | None]]:
    a = WAV_A
    fmt = chunk(b"fmt ", noise("fmt", 16))
    info = chunk(b"LIST", b"INFO" + chunk(b"INAM", b"Title one\x00"))
    info2 = chunk(b"LIST", b"INFO" + chunk(b"INAM", b"A longer title\x00"))
    odd = chunk(b"junk", b"abc")
    ds64 = chunk(b"ds64", (0).to_bytes(8, "little") + len(a).to_bytes(8, "little") + b"\x00" * 12)
    body = ds64 + fmt + b"data" + (0xFFFFFFFF).to_bytes(4, "little") + a
    rf64_riff = (4 + len(body)).to_bytes(8, "little")
    body = body.replace(ds64, ds64[:8] + rf64_riff + ds64[16:], 1)
    rf64 = b"RF64" + (0xFFFFFFFF).to_bytes(4, "little") + b"WAVE" + body
    return [
        ("wav-a-bare.wav", "wav-a", riff(fmt + chunk(b"data", a)), expected(a)),
        ("wav-a-info-before.wav", "wav-a", riff(fmt + info + chunk(b"data", a)), expected(a)),
        (
            "wav-a-info-after.wav",
            "wav-a",
            riff(fmt + odd + chunk(b"data", a) + info2 + chunk(b"id3 ", id3v2("t", 3))),
            expected(a),
        ),
        (
            "wav-a-trailing-id3.wav",
            "wav-a",
            riff(fmt + chunk(b"data", a)) + id3v1("x"),
            expected(a),
        ),
        ("wav-a-rf64.wav", "wav-a", rf64, expected(a)),
        (
            "wav-bad-two-data.wav",
            None,
            riff(fmt + chunk(b"data", a) + chunk(b"data", a[:10])),
            None,
        ),
        ("wav-bad-data-too-long.wav", None, riff(fmt + chunk(b"data", a))[:-20], None),
        ("wav-bad-no-data.wav", None, riff(fmt + info), None),
    ]


def form(kind: bytes, chunks: bytes) -> bytes:
    return b"FORM" + (4 + len(chunks)).to_bytes(4, "big") + kind + chunks


def ssnd(sound: bytes, offset: int = 0) -> bytes:
    data = offset.to_bytes(4, "big") + (0).to_bytes(4, "big") + b"\x00" * offset + sound
    return chunk(b"SSND", data, big=True)


def aiff_files() -> list[tuple[str, str | None, bytes, str | None]]:
    a = AIFF_A
    comm = chunk(b"COMM", noise("comm", 18), big=True)
    name = chunk(b"NAME", b"Title one", big=True)
    return [
        ("aiff-a-bare.aiff", "aiff-a", form(b"AIFF", comm + ssnd(a)), expected(a)),
        ("aiff-a-named.aiff", "aiff-a", form(b"AIFF", comm + name + ssnd(a)), expected(a)),
        (
            "aiff-a-offset.aif",
            "aiff-a",
            form(b"AIFF", comm + ssnd(a, 4) + chunk(b"ID3 ", id3v2("t", 2), big=True)),
            expected(a),
        ),
        ("aiff-a-aifc.aifc", "aiff-a", form(b"AIFC", comm + ssnd(a)), expected(a)),
        ("aiff-bad-no-ssnd.aiff", None, form(b"AIFF", comm + name), None),
        (
            "aiff-bad-offset.aiff",
            None,
            form(b"AIFF", comm + chunk(b"SSND", (99).to_bytes(4, "big") + b"\x00" * 12, True)),
            None,
        ),
    ]


# ---- Ogg ------------------------------------------------------------------------------------


def pages(packets: list[bytes], serial: int, per_page: int, finish: bool = True) -> list[bytes]:
    """Ogg pages for these packets, at most `per_page` segments a page (checksums left zero)."""
    segments: list[tuple[bytes, bool]] = []  # (bytes, starts a new packet)
    for packet in packets:
        values = [255] * (len(packet) // 255) + [len(packet) % 255]
        at = 0
        for index, value in enumerate(values):
            segments.append((packet[at : at + value], index == 0))
            at += value
    if not finish:
        segments = segments[:-1]
    out: list[bytes] = []
    for number, start in enumerate(range(0, len(segments), per_page)):
        group = segments[start : start + per_page]
        flags = 0 if group[0][1] else 0x01
        if number == 0:
            flags |= 0x02
        if start + per_page >= len(segments):
            flags |= 0x04
        lacing = bytes(len(data) for data, _ in group)
        head = b"OggS\x00" + bytes([flags]) + b"\x00" * 8 + serial.to_bytes(4, "little")
        head += number.to_bytes(4, "little") + b"\x00" * 4 + bytes([len(group)]) + lacing
        out.append(head + b"".join(data for data, _ in group))
    return out


AUDIO = [noise(f"ogg-audio-{n}", size) for n, size in enumerate((40, 300, 255, 7, 600, 90))]
VORBIS = [b"\x01vorbis" + noise("vorbis-id", 23), b"\x05vorbis" + noise("setup", 200)]
OPUS_HEAD = b"OpusHead" + noise("opus-head", 11)


def ogg_files() -> list[tuple[str, str | None, bytes, str | None]]:
    def vorbis(comment: bytes) -> list[bytes]:
        return [VORBIS[0], b"\x03vorbis" + comment, VORBIS[1], *AUDIO]

    vorbis_payload = VORBIS[0] + VORBIS[1] + b"".join(AUDIO)
    opus = [OPUS_HEAD, b"OpusTags" + b"title=one", *AUDIO]
    opus2 = [OPUS_HEAD, b"OpusTags" + noise("big comment", 700), *AUDIO]
    opus_payload = OPUS_HEAD + b"".join(AUDIO)
    tagged = b"".join(pages(vorbis(b"title=one"), 7, 4))
    other = pages([b"\x80theora" + noise("video", 60), noise("frame", 80)], 9, 1)
    mine = pages(vorbis(b"title=two"), 7, 3)
    mixed = b"".join([mine[0], other[0], *mine[1:3], other[1], *mine[3:]])
    flac_in_ogg = b"".join(pages([b"\x7fFLAC" + noise("x", 20), b"\x84" + b"x" * 9, *AUDIO], 3, 4))
    return [
        ("ogg-vorbis-a-tagged.ogg", "ogg-vorbis-a", tagged, expected(vorbis_payload)),
        (
            "ogg-vorbis-a-retitled.ogg",
            "ogg-vorbis-a",
            b"".join(pages(vorbis(noise("long comment", 900)), 7, 5)),
            expected(vorbis_payload),
        ),
        ("ogg-vorbis-a-multiplexed.ogg", "ogg-vorbis-a", mixed, expected(vorbis_payload)),
        (
            "ogg-opus-a-tagged.opus",
            "ogg-opus-a",
            b"".join(pages(opus, 1, 3)),
            expected(opus_payload),
        ),
        (
            "ogg-opus-a-artwork.opus",
            "ogg-opus-a",
            b"".join(pages(opus2, 2, 6)),
            expected(opus_payload),
        ),
        ("ogg-bad-flac-in-ogg.oga", None, flac_in_ogg, None),
        ("ogg-bad-truncated.ogg", None, tagged[:-10], None),
        ("ogg-bad-junk-after.ogg", None, tagged + b"junk", None),
        (
            "ogg-bad-unfinished.ogg",
            None,
            # the last packet loses its final segment, so it never ends
            b"".join(pages([*vorbis(b"t"), noise("tail", 300)], 7, 4, finish=False)),
            None,
        ),
        ("ogg-bad-no-first-flag.ogg", None, tagged[:5] + b"\x00" + tagged[6:], None),
    ]


def other_files() -> list[tuple[str, str | None, bytes, str | None]]:
    return [
        ("other-bad-empty.mp3", None, b"", None),
        ("other-bad-text.mp3", None, b"not music at all, just words", None),
        ("other-bad-wma.wma", None, b"\x30\x26\xb2\x75\x8e\x66\xcf\x11" + noise("wma", 100), None),
    ]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    built = mp3_files() + flac_files() + mp4_files() + wav_files() + aiff_files() + ogg_files()
    built += other_files()
    entries = []
    wrong = []
    scratch = Path(tempfile.mkdtemp(prefix="audio-identity-"))
    for name, group, data, want in built:
        # The repo ignores audio file names on purpose (it is public), so the bytes travel in
        # the manifest as base64 and the file only ever exists in a temporary folder.
        path = scratch / name
        path.write_bytes(data)
        # also beside the manifest, where the folder is let back into git for these made-up files
        (OUT / name).write_bytes(data)
        got = audio_id(path)
        if got != want:
            wrong.append(f"{name}: expected {want}, the Python implementation says {got}")
        entries.append(
            {
                "file": name,
                "group": group,
                "audio_id": want,
                "size": len(data),
                "bytes": base64.b64encode(data).decode("ascii"),
            }
        )
    shutil.rmtree(scratch, ignore_errors=True)
    groups: dict[str, set[str | None]] = {}
    for entry in entries:
        if entry["group"]:
            groups.setdefault(entry["group"], set()).add(entry["audio_id"])
    wrong += [f"group {name} has {len(ids)} ids" for name, ids in groups.items() if len(ids) != 1]
    if wrong:
        print("\n".join(wrong))
        return 1
    manifest = {"version": "a1", "spec": "docs/engineering/audio-identity.md", "files": entries}
    # always LF, so the generator's output is the same file on every machine
    (OUT / "manifest.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode())
    print(f"{len(entries)} fixtures written to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
