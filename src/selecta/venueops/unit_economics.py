"""Unit economics per venue (ADR-0438, AV-0438-04).

What one venue costs SelectaDJ to serve for a month: compute, storage, egress, licences and
support, against a price. The inputs live in `docs/autopilot/unit-economics-inputs.json`, where
every number is marked as an assumption to confirm. Licence costs and the price are unknown
(null) until a rights quote and the market work exist, and the model says so: a result with any
unknown input is `complete = False`, lists what is missing, and reports a margin only for the
known costs. It never fills an unknown with a guess.

    python -m selecta.venueops.unit_economics [inputs.json]
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

FLAG = "venue.rollout_gates"
ROOT = Path(__file__).resolve().parents[3]
DEFAULT_INPUTS = ROOT / "docs" / "autopilot" / "unit-economics-inputs.json"
GB_PER_KBPS_HOUR = 3600 / 8 / 1_000_000  # kbit/s for one hour, in GB


@dataclass
class Economics:
    lines: dict[str, float | None]
    unknown: list[str]
    assumptions: list[str]
    price: float | None
    notes: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not self.unknown

    @property
    def known_cost(self) -> float:
        return round(sum(v for v in self.lines.values() if v is not None), 2)

    @property
    def margin(self) -> float | None:
        """Gross margin on known costs; None without a price."""
        if self.price is None or self.price <= 0:
            return None
        return round((self.price - self.known_cost) / self.price, 4)

    def as_dict(self) -> dict:
        return {
            "complete": self.complete,
            "lines": self.lines,
            "known_cost_per_venue_month": self.known_cost,
            "price_per_venue_month": self.price,
            "gross_margin_on_known_costs": self.margin,
            "unknown_inputs": self.unknown,
            "assumption_inputs": self.assumptions,
            "notes": self.notes,
        }


def load(path: Path = DEFAULT_INPUTS) -> dict:
    return json.loads(Path(path).read_text("utf-8"))


def _value(inputs: dict, section: str, key: str, unknown: list[str], assumed: list[str]):
    entry = inputs[section][key]
    name = f"{section}.{key}"
    if entry.get("value") is None:
        unknown.append(name)
        return None
    if "assumption" in str(entry.get("source", "")).lower():
        assumed.append(name)
    return float(entry["value"])


def model(inputs: dict) -> Economics:
    unknown: list[str] = []
    assumed: list[str] = []

    def v(section: str, key: str):
        return _value(inputs, section, key, unknown, assumed)

    hours = v("venue", "hours_per_month")
    zones = v("venue", "zones")
    play_hours = hours * zones if hours is not None and zones is not None else None

    def mul(*parts):
        if any(p is None for p in parts):
            return None
        out = 1.0
        for p in parts:
            out *= p
        return round(out, 2)

    compute = mul(play_hours, v("compute", "cpu_hours_per_play_hour"),
                  v("compute", "cpu_hour_price"))
    library, cache = v("venue", "library_gb"), v("venue", "render_cache_gb")
    gb = library + cache if library is not None and cache is not None else None
    storage = mul(gb, v("storage", "gb_month_price"))
    streamed_gb = mul(play_hours, v("venue", "stream_kbps"), GB_PER_KBPS_HOUR,
                      v("venue", "streamed_share"))
    egress = mul(streamed_gb, v("egress", "gb_price"))
    support = mul(v("support", "tickets_per_venue_month"), v("support", "minutes_per_ticket"),
                  v("support", "cost_per_support_minute"))
    lines: dict[str, float | None] = {
        "compute": compute,
        "storage": storage,
        "egress": egress,
        "licence.music_supply": v("licences", "music_supply_per_venue_month"),
        "licence.public_performance": v("licences", "public_performance_paid_by_selectadj"),
        "licence.models": v("licences", "model_licences_per_venue_month"),
        "support": support,
    }
    price = v("price", "per_venue_month")
    notes = []
    if unknown:
        notes.append("Incomplete: unknown inputs are not guessed; the margin covers known costs "
                     "only and must not be quoted as the venue margin.")
    if assumed:
        notes.append("Every assumption input must be confirmed before a decision.")
    return Economics(lines, unknown, assumed, price, notes)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    result = model(load(Path(args[0]) if args else DEFAULT_INPUTS))
    print(json.dumps(result.as_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
