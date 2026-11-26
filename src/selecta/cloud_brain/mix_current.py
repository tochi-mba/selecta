"""The account's current mix changed: every open device hears it (`mix.current`).

`local_media/current_mix.py` says which recipe is current. With `cloud.account_mixes` the current
mix is the account's own (the `queue` rows), so each route that changes which mix is current (a
whole new order, playing a draft, Undo, clearing) sends the same topic, marked `account`, with
what the mix now is: its song ids in order, its name, and the device that changed it. A device
that already shows that order does nothing; another reads `GET /api/mix` again; a speaker keeps
playing and offers the new mix (web/src/cloud/useAccountMix.tsx). Two devices: the last change
stands, and Undo brings back the one before it, which every device hears the same way.

The event is sent inside the route's own write, so it goes out only when the change does.
`mix_id` and `revision` read as "no recipe chosen" to a browser built before this.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.engine_store.mixes import StoreMixes
from selecta.flags.matching import Rule, RuleKind
from selecta.local_media.current_mix import TOPIC

# the query parameter a change names its device by, as `/requests/insert` does
DEVICE_PARAM = "device_id"
# Account mixes for every account with the cloud library and for no other. Saved as the rules of
# `cloud.account_mixes`, it decides once the build carries `+cloud.account_mixes`, whose default
# stays off (engine-store-mixes.md, "Turning it on").
WITH_THE_CLOUD_LIBRARY = Rule(
    RuleKind.FOLLOWS,
    {"flag": "cloud.hosted_media", "note": "account mixes go where the cloud library goes"},
)


def device_name(mixes: StoreMixes, device_id: str | None) -> str | None:
    """The changing device's name, when it is a signed-in device of this workspace."""
    from selecta.playback.schema import devices

    if not device_id or len(device_id) > 64:
        return None
    return mixes.connection.execute(
        sa.select(devices.c.name).where(
            devices.c.workspace_id == mixes.store.workspace_id, devices.c.id == device_id
        )
    ).scalar()


def told(mixes: StoreMixes, answer: dict, device_id: str | None) -> dict:
    """Send `mix.current` for the current mix in `answer` (the route's own reply, so the order is
    the one every device reads back). Returns `answer`."""
    from selecta.persistence import db_now
    from selecta.work import outbox

    connection = mixes.connection
    songs = [item["song_id"] for item in answer["mix"]]
    now = db_now(connection)
    event = {
        "account": True,
        "mix_id": None,
        "revision": 0,
        "order": ",".join(str(song) for song in songs),
        "songs": len(songs),
        "name": answer["name"],
        "updated_at": now,
        "updated_by_device_name": device_name(mixes, device_id),
    }
    outbox.emit(connection, TOPIC, mixes.store.workspace_id, event, now)
    return answer


__all__ = ["DEVICE_PARAM", "WITH_THE_CLOUD_LIBRARY", "device_name", "told"]
