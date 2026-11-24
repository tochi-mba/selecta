"""What is true right now, for Lucy's next turn in browser-first Cloud (ADR-0476 items 22-25).

Read fresh before every model call, never carried over from earlier in the conversation: which
device this message came from, the person's devices and which are open, what each holds, which
device is playing (the session's speaker) and whose it is, the default speaker, and the current
mix. Lucy is told this block wins over anything said earlier. Only names, counts and states go
to the model; no device ids, fingerprints or file details.

The device rule itself (which device plays) is ADR-0475's and lives in the shell and
`selecta.playback`; this only describes the state so Lucy can say it truthfully.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.local_media import current_mix, recipes, store
from selecta.persistence import db_now
from selecta.playback import default_speaker
from selecta.playback import store as playback_store
from selecta.playback.schema import devices as playback_devices

OPEN_SECONDS = 120
"""A device seen within this long is open now (it polls while a page is open)."""


def _devices(conn: Connection, workspace_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        sa.select(playback_devices.c.id, playback_devices.c.name, playback_devices.c.kind,
                  playback_devices.c.user_id, playback_devices.c.last_seen_at)
        .where(playback_devices.c.workspace_id == workspace_id)
        .where(playback_devices.c.signed_out_at.is_(None))
        .where(playback_devices.c.zone_id.is_(None))
        .order_by(playback_devices.c.name)
    ).mappings().all()
    holdings = store.holding_counts(conn, workspace_id)
    now = db_now(conn)
    return [
        {"id": row["id"], "name": row["name"], "kind": row["kind"], "user": row["user_id"],
         "open": now - float(row["last_seen_at"] or 0) <= OPEN_SECONDS,
         "songs": holdings.get(str(row["id"]), {}).get("songs", 0)}
        for row in rows
    ]


def snapshot(
    conn: Connection, workspace_id: str, user_id: str, sender_device: str | None
) -> dict[str, Any]:
    devices = _devices(conn, workspace_id)
    by_id = {d["id"]: d for d in devices}
    session = playback_store.load_session(conn, workspace_id)
    speaker = by_id.get(session.active_device_id) if session and session.active_device_id else None
    default_id = default_speaker.read(conn, workspace_id)
    mix_id = current_mix.read(conn, workspace_id).get("mix_id")
    mix_name = None
    if mix_id:
        try:
            mix_name = recipes.read(conn, workspace_id, mix_id)["mix"]["name"]
        except recipes.RecipeError:
            mix_name = None
    return {
        "sender": by_id.get(sender_device) if sender_device else None,
        "devices": devices,
        "speaker": speaker,
        "speaker_state": session.state.value if session else "stopped",
        "speaker_is_someone_elses": bool(
            speaker and speaker["user"] and speaker["user"] != user_id
        ),
        "default_speaker": by_id.get(default_id) if default_id else None,
        "mix": mix_name,
    }


def words(state: dict[str, Any]) -> str:
    """The state as a short block of plain lines for the system prompt."""

    def device(d: dict[str, Any]) -> str:
        held = f"holds {d['songs']} songs" if d["songs"] else "holds no songs right now"
        return f"{d['name']} ({d['kind']}, {'open' if d['open'] else 'not open'}, {held})"

    lines = ["Right now (fresh for this message; it wins over anything said earlier):"]
    sender = state["sender"]
    lines.append(f"- This message was sent from {device(sender)}; \"here\" means that device."
                 if sender else "- This message's device isn't known; ask if \"here\" matters.")
    if state["devices"]:
        lines.append("- The person's devices: " + "; ".join(device(d) for d in state["devices"])
                     + ".")
        names = [d["name"].casefold() for d in state["devices"]]
        twice = sorted({n for n in names if names.count(n) > 1})
        if twice:
            lines.append(f"- More than one device is called {', '.join(twice)}: ask which.")
    else:
        lines.append("- No devices are signed in.")
    speaker = state["speaker"]
    if speaker:
        whose = (" It is another member's device: say whose session it is and ask before "
                 "suggesting a change to what plays.") if state["speaker_is_someone_elses"] else ""
        lines.append(f"- Playing on: {speaker['name']} ({state['speaker_state']}).{whose}")
    else:
        lines.append("- Nothing is playing on any device.")
    if state["default_speaker"]:
        lines.append(f"- Default speaker: {state['default_speaker']['name']}.")
    lines.append(f"- Current mix: {state['mix']}." if state["mix"] else "- No current mix.")
    return "\n".join(lines)


__all__ = ["snapshot", "words"]
