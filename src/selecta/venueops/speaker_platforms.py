"""Speaker platform certification matrix (ADR-0433 AV-0433-01).

Which kinds of device a venue may use as its speaker, which checks each must pass before SelectaDJ
calls it certified, and the recorded results. Every result starts as "not certified": only a person
running the check on the named hardware can record a pass or a fail, with who, when and the
evidence. Code never marks a platform certified on its own.

The tiers follow what `selecta.playback.devices` already knows: a desktop browser is a good
speaker, an Android tablet can be one with the screen kept on, an iPad suspends audio when the
screen locks, and an iPhone or a device without audio is a remote, never a venue speaker.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path

FLAG = "venue.speakers"


class Tier(StrEnum):
    PRIMARY = "primary"  # recommended venue speaker, certified first
    SECONDARY = "secondary"  # allowed with the warnings shown
    REMOTE_ONLY = "remote_only"  # never a venue speaker


class Result(StrEnum):
    NOT_CERTIFIED = "not certified"
    PASSED = "passed"
    FAILED = "failed"


@dataclass(frozen=True)
class Check:
    id: str
    title: str
    how: str


CHECKS: tuple[Check, ...] = (
    Check("soak_6h", "Six hours without a gap over the targets",
          "Run docs/autopilot/six-hour-soak-protocol.md on this hardware; attach the report."),
    Check("wake_lock", "Screen and audio stay awake",
          "Leave the device untouched for 30 minutes while playing; music never stops."),
    Check("network_drop", "Survives a network drop",
          "Pull the network for 60 seconds mid-song; a fallback plays, nothing goes silent."),
    Check("lease_fence", "Only one speaker plays",
          "Transfer to a second device; the first goes quiet within one second, no echo."),
    Check("reconnect_resume", "Reconnects and resumes",
          "Close and reopen the speaker tab; it resumes the zone or stays quiet if replaced."),
    Check("output_route", "Plays through the venue system",
          "Select the venue output (USB or line out); level is steady at the soundcheck mark."),
    Check("autoplay_reload", "Recovers after a reload",
          "Reload the speaker page; one tap starts audio again and the night continues."),
)
CHECK_IDS = tuple(c.id for c in CHECKS)


@dataclass(frozen=True)
class Platform:
    id: str
    name: str
    tier: Tier
    note: str
    checks: tuple[str, ...] = CHECK_IDS


PLATFORMS: tuple[Platform, ...] = (
    Platform("windows-chromium", "Windows PC, Chrome or Edge", Tier.PRIMARY,
             "Wired network and the venue's audio interface recommended."),
    Platform("macos-chromium-safari", "Mac, Chrome, Edge or Safari", Tier.PRIMARY,
             "Turn off sleep in Energy settings for the night."),
    Platform("android-tablet-chrome", "Android tablet, Chrome", Tier.SECONDARY,
             "Keep it on charge with the screen on."),
    Platform("ipad-safari", "iPad, Safari", Tier.SECONDARY,
             "Audio stops if the screen locks; turn Auto-Lock off for the night."),
    Platform("iphone-safari", "iPhone", Tier.REMOTE_ONLY,
             "iPhone suspends audio when the screen locks; use it as a remote.", ()),
    Platform("no-audio", "Any device that can't play audio", Tier.REMOTE_ONLY,
             "It can steer the night but never be the speaker.", ()),
)
PLATFORM_BY_ID = {p.id: p for p in PLATFORMS}


@dataclass(frozen=True)
class Record:
    platform: str
    check: str
    result: Result = Result.NOT_CERTIFIED
    hardware: str = ""  # the named device, model and OS version
    by: str = ""  # the person who ran it
    on: str = ""  # ISO date
    evidence: str = ""  # path or link to the report, screenshots or recording


class CertificationError(ValueError):
    pass


@dataclass
class Matrix:
    records: dict[tuple[str, str], Record] = field(default_factory=dict)

    def record(self, platform: str, check: str) -> Record:
        self._known(platform, check)
        return self.records.get((platform, check), Record(platform, check))

    @staticmethod
    def _known(platform: str, check: str) -> Platform:
        found = PLATFORM_BY_ID.get(platform)
        if found is None:
            raise CertificationError(f"Unknown speaker platform {platform!r}.")
        if check not in found.checks:
            raise CertificationError(f"{found.name} has no check {check!r}.")
        return found

    def record_result(
        self,
        platform: str,
        check: str,
        *,
        passed: bool,
        hardware: str,
        by: str,
        evidence: str,
        on: dt.date | None = None,
    ) -> Record:
        """Record what a person saw. Who, which hardware and the evidence are all required."""
        self._known(platform, check)
        if not by.strip() or not hardware.strip() or not evidence.strip():
            raise CertificationError(
                "A certification result needs the person, the named hardware and the evidence."
            )
        found = Record(platform, check, Result.PASSED if passed else Result.FAILED,
                       hardware.strip(), by.strip(), (on or dt.date.today()).isoformat(),
                       evidence.strip())
        self.records[(platform, check)] = found
        return found

    def certified(self, platform: str) -> bool:
        found = PLATFORM_BY_ID.get(platform)
        if found is None or found.tier is Tier.REMOTE_ONLY or not found.checks:
            return False
        return all(self.record(platform, c).result is Result.PASSED for c in found.checks)

    def status(self, platform: str) -> str:
        found = PLATFORM_BY_ID[platform]
        if found.tier is Tier.REMOTE_ONLY:
            return "remote only"
        results = [self.record(platform, c).result for c in found.checks]
        if Result.FAILED in results:
            return "failed"
        if all(r is Result.PASSED for r in results):
            return "certified"
        return "not certified"

    def rows(self) -> list[dict]:
        return [
            {"platform": p.id, "name": p.name, "tier": p.tier.value, "status": self.status(p.id),
             "checks": {c: self.record(p.id, c).result.value for c in p.checks}}
            for p in PLATFORMS
        ]

    def markdown(self) -> str:
        head = "| Platform | Tier | Status | " + " | ".join(CHECK_IDS) + " |"
        rule = "|" + "---|" * (3 + len(CHECK_IDS))
        lines = [head, rule]
        for p in PLATFORMS:
            cells = [self.record(p.id, c).result.value if c in p.checks else "n/a"
                     for c in CHECK_IDS]
            lines.append(f"| {p.name} | {p.tier.value} | {self.status(p.id)} | "
                         + " | ".join(cells) + " |")
        return "\n".join(lines)

    def save(self, path: Path) -> None:
        rows = [{**asdict(r), "result": r.result.value} for r in self.records.values()]
        path.write_text(json.dumps({"records": rows}, indent=2) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> Matrix:
        matrix = cls()
        if not path.is_file():
            return matrix
        for row in json.loads(path.read_text(encoding="utf-8")).get("records", []):
            matrix._known(row["platform"], row["check"])
            record = Record(row["platform"], row["check"], Result(row["result"]),
                            row.get("hardware", ""), row.get("by", ""), row.get("on", ""),
                            row.get("evidence", ""))
            if record.result is not Result.NOT_CERTIFIED and not record.by:
                raise CertificationError("A recorded result without a person is not accepted.")
            matrix.records[(record.platform, record.check)] = record
        return matrix


def primary_platforms() -> list[Platform]:
    return [p for p in PLATFORMS if p.tier is Tier.PRIMARY]
