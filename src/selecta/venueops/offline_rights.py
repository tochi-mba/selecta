"""Offline media copies gated on rights (ADR-0433 AV-0433-04).

A venue speaker may keep songs on its own disk so the night survives the internet going away.
That copy is only allowed when the song's licence is cleared for this venue and explicitly allows
offline use, and it lasts no longer than the licence, nor longer than `MAX_OFFLINE_DAYS` before it
must be checked again. When a licence expires or is withdrawn, the copies it allowed are removed.

The original song is never written to: copies are read from it into the cache folder, checked by
hash, and only files inside the cache folder are ever deleted. Gated by `venue.speakers`.
"""

from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from selecta import flags

FLAG = "venue.speakers"
MAX_OFFLINE_DAYS = 30
DAY_S = 86400.0


class OfflineRefused(PermissionError):
    def __init__(self, song_id: str, reason: str) -> None:
        self.song_id = song_id
        self.reason = reason
        super().__init__(f"No offline copy of {song_id!r}: {reason}.")


@dataclass(frozen=True)
class Licence:
    licence_id: str
    song_id: str
    venue_id: str
    cleared: bool
    allows_offline: bool
    expires_at: float  # epoch seconds
    revoked: bool = False


@dataclass(frozen=True)
class OfflineCopy:
    song_id: str
    licence_id: str
    path: Path
    sha256: str
    expires_at: float


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def refusal(licence: Licence | None, song_id: str, venue_id: str, now: float) -> str | None:
    """Why an offline copy is not allowed, or None when it is."""
    if licence is None:
        return "there is no licence on record"
    if licence.song_id != song_id:
        return "the licence is for a different song"
    if licence.venue_id != venue_id:
        return "the licence is for a different venue"
    if licence.revoked:
        return "the licence was withdrawn"
    if not licence.cleared:
        return "the licence is not cleared"
    if not licence.allows_offline:
        return "the licence does not allow offline copies"
    if licence.expires_at <= now:
        return "the licence has expired"
    return None


@dataclass
class OfflineStore:
    venue_id: str
    folder: Path
    copies: dict[str, OfflineCopy] = field(default_factory=dict)
    log: list[str] = field(default_factory=list)

    def _inside(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.folder.resolve())
        except ValueError:
            return False
        return True

    def keep_offline(self, song_id: str, original: Path, licence: Licence | None,
                     now: float) -> OfflineCopy:
        """Copy a song for offline play, if its licence allows it."""
        flags.require(FLAG)
        reason = refusal(licence, song_id, self.venue_id, now)
        if reason is not None:
            self.log.append(f"refused {song_id}: {reason}")
            raise OfflineRefused(song_id, reason)
        assert licence is not None
        self.folder.mkdir(parents=True, exist_ok=True)
        before = _sha256(original)
        target = self.folder / f"{hashlib.sha256(song_id.encode()).hexdigest()[:24]}.media"
        if self._inside(original):
            raise OfflineRefused(song_id, "the original is already inside the offline folder")
        shutil.copyfile(original, target)  # reads the original, writes only the copy
        if _sha256(target) != before:
            target.unlink(missing_ok=True)
            raise OfflineRefused(song_id, "the copy did not match the original")
        expires = min(licence.expires_at, now + MAX_OFFLINE_DAYS * DAY_S)
        copy = OfflineCopy(song_id, licence.licence_id, target, before, expires)
        self.copies[song_id] = copy
        self.log.append(f"kept {song_id} until {expires:.0f}")
        return copy

    def playable(self, song_id: str, now: float) -> Path | None:
        """The offline file to play, only while its permission lasts and it is intact."""
        copy = self.copies.get(song_id)
        if copy is None or copy.expires_at <= now or not copy.path.is_file():
            return None
        return copy.path

    def _remove(self, song_id: str, why: str) -> None:
        copy = self.copies.pop(song_id, None)
        if copy is None:
            return
        if self._inside(copy.path):  # never delete anything outside the offline folder
            copy.path.unlink(missing_ok=True)
        self.log.append(f"removed {song_id}: {why}")

    def expire(self, now: float) -> list[str]:
        """Remove every copy whose permission has run out. Returns the song ids removed."""
        gone = [s for s, c in self.copies.items() if c.expires_at <= now]
        for song_id in gone:
            self._remove(song_id, "permission expired")
        return gone

    def withdraw(self, licence_id: str) -> list[str]:
        """A licence was withdrawn: remove every copy it allowed, at once."""
        gone = [s for s, c in self.copies.items() if c.licence_id == licence_id]
        for song_id in gone:
            self._remove(song_id, "licence withdrawn")
        return gone

    def recheck(self, licences: dict[str, Licence], now: float) -> list[str]:
        """Re-check every copy against current licences, removing any no longer allowed."""
        gone: list[str] = []
        for song_id, copy in list(self.copies.items()):
            licence = licences.get(copy.licence_id)
            if refusal(licence, song_id, self.venue_id, now) is not None:
                self._remove(song_id, "licence no longer allows it")
                gone.append(song_id)
        return gone
