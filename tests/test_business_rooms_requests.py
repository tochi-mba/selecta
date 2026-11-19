"""BZ-0451-02 to -09: codes, the screen code, the staff queue, content rules, limits, venue
networks, guest payloads, abuse handling and the zone planner's slot, on `ZoneRooms`.

The content engine is the planted checker from `test_business_rooms_support` (blocked, explicit
and out-of-range songs refused); one test runs the real engine through `EngineContent`.
"""

from __future__ import annotations

import json

import pytest
import sqlalchemy as sa
from test_business_rooms_support import (  # noqa: F401
    BAR,
    Clock,
    TERRACE,
    Flags,
    activity_kinds,
    code_of,
    configure,
    kiosk,
    manager,
    seen,
    staff,
    tablet,
)

from selecta.business.access import BusinessConflict, BusinessInvalid
from selecta.business.rooms import screen_code, settings
from selecta.business.rooms.errors import Refused
from selecta.business.rooms.schema import business_zone_room_guests as guests_t
from selecta.business.rooms.schema import business_zone_room_requests as requests_t
from selecta.persistence import transaction

pytest_plugins = ("test_business_rooms_support",)

IP = "203.0.113.7"


@pytest.fixture
def clock():
    """The callable room-service clock, not the database clock fixture of the same name."""
    return Clock()


def joined(svc, zone_id=BAR, ip=IP):
    return svc.join(code_of(svc, zone_id), ip)


def ask(svc, guest, song_id, **extra):
    return svc.place(guest.token, song_id, **extra)


def status_of(svc, request_id):
    with svc.engine.connect() as conn:
        return conn.execute(sa.select(requests_t.c.status).where(
            requests_t.c.id == request_id)).scalar_one()


def staffed(svc):
    """Staff open the queue, so the room isn't 'paused for now'."""
    seen(svc)


# ---- codes, rotation and the screen code -----------------------------------------------------

def test_codes_stay_until_rotated_and_old_cards_then_say_so(make):
    svc = make()
    first = code_of(svc)
    assert code_of(svc) == first
    guest = svc.join(first, IP)
    with transaction(svc.engine) as conn:
        rotated = svc.rotate(conn, manager(), BAR)
    assert "stop working" in rotated["warning"]
    assert code_of(svc) != first
    with pytest.raises(Refused) as gone:
        svc.join(first, "198.51.100.1")
    assert gone.value.status == 410 and gone.value.message == settings.TEXT_CODE_CHANGED
    assert svc.guest_state(guest.token, first)["room_id"] == guest.room_id  # still in


def test_the_print_sheet_lists_each_zone_with_its_link(make):
    svc = make()
    with transaction(svc.engine) as conn:
        sheet = svc.print_data(conn, manager(), "venue-1")
    assert [zone["zone_name"] for zone in sheet["zones"]] == ["Bar", "Terrace"]
    assert all(zone["join_url"].endswith("?at=venue") for zone in sheet["zones"])


def test_the_screen_code_changes_every_fifteen_minutes_and_requests_need_it(make, clock):
    svc = make()
    configure(svc, {"screen_code_on": True})
    staffed(svc)
    guest = joined(svc)
    with transaction(svc.engine) as conn:
        shown = svc.screen_code(conn, kiosk(), BAR)
    assert shown["on"] and shown["code"]
    with pytest.raises(Refused) as missing:
        ask(svc, guest, "s1")
    assert missing.value.code == "screen_code"
    assert ask(svc, guest, "s1", typed_screen_code=shown["code"])["request_id"]
    clock.advance(settings.SCREEN_WINDOW_S + settings.SCREEN_GRACE_S + 1)
    with transaction(svc.engine) as conn:
        later = svc.screen_code(conn, kiosk(), BAR)
    assert later["code"] != shown["code"]
    with transaction(svc.engine) as conn:
        seed = conn.execute(sa.text("SELECT screen_seed FROM business_zone_rooms WHERE zone_id = "
                                    ":z"), {"z": BAR}).scalar_one()
    assert not screen_code.matches(seed, svc.pepper, shown["code"], clock())


# ---- the staff queue -----------------------------------------------------------------------

def test_approve_and_pass_are_attributed_and_double_approval_resolves_to_one(make):
    svc = make()
    staffed(svc)
    guest = joined(svc)
    first = ask(svc, guest, "s1")["request_id"]
    queue = seen(svc)
    assert [item["id"] for item in queue] == [first] and queue[0]["guest_id"]
    with transaction(svc.engine) as conn:
        assert svc.decide(conn, tablet(), BAR, first, "approve")["decided_by"] == "Bar tablet"
    with transaction(svc.engine) as conn, pytest.raises(BusinessConflict) as twice:
        svc.decide(conn, staff(), BAR, first, "approve")
    assert str(twice.value) == "Already approved by Bar tablet"


def test_an_unanswered_request_expires_after_twenty_minutes(make, clock):
    svc = make()
    staffed(svc)
    request_id = ask(svc, joined(svc), "s1")["request_id"]
    clock.advance(19 * 60)
    staffed(svc)
    assert status_of(svc, request_id) == "sent"
    clock.advance(2 * 60)
    staffed(svc)
    assert status_of(svc, request_id) == "expired"


def test_requests_pause_when_no_staff_device_was_seen_for_ten_minutes(make, clock):
    svc = make()
    guest = joined(svc)
    assert svc.guest_state(guest.token)["text"] == settings.TEXT_PAUSED
    staffed(svc)
    assert svc.guest_state(guest.token)["state"] == "open"
    clock.advance(settings.STAFF_ABSENT_S + 1)
    assert svc.guest_state(guest.token)["text"] == settings.TEXT_PAUSED
    configure(svc, {"mode": settings.AUTO_ACCEPT})
    assert svc.guest_state(guest.token)["state"] == "open"  # nobody needs to approve


# ---- content rules -------------------------------------------------------------------------

def test_search_shows_only_allowed_songs_and_never_why(make, content):
    svc = make()
    staffed(svc)
    guest = joined(svc)
    found = {song["song_id"] for song in svc.search(guest.token, "Song", limit=100)}
    assert "blocked" in found and {"explicit", "fast"}.isdisjoint(found)
    content.blocked.add("blocked")
    found = {song["song_id"] for song in svc.search(guest.token, "Song", limit=100)}
    assert {"blocked", "explicit", "fast"}.isdisjoint(found)
    body = json.dumps(svc.search(guest.token, "Song", limit=5))
    assert "blocklist" not in body and "explicit\"" not in body


def test_a_refused_song_is_refused_when_placed_and_withdrawn_when_its_slot_comes(make, content):
    svc = make()
    staffed(svc)
    guest = joined(svc)
    with pytest.raises(Refused) as refused:
        ask(svc, guest, "explicit")
    assert refused.value.message == settings.TEXT_DOESNT_FIT
    request_id = ask(svc, guest, "s1")["request_id"]
    with transaction(svc.engine) as conn:
        svc.decide(conn, staff(), BAR, request_id, "approve")
    content.blocked.add("s1")  # the rules changed after approval
    assert svc.slot_up(BAR) is None
    assert status_of(svc, request_id) == "withdrawn"
    mine = svc.guest_state(guest.token)["my_requests"][0]
    assert mine["text"] == settings.TEXT_DOESNT_FIT


def test_the_slot_gives_the_next_approved_request_and_marks_it_played(make):
    svc = make()
    staffed(svc)
    one, two = joined(svc), joined(svc, ip="198.51.100.9")
    first = ask(svc, one, "s1")["request_id"]
    second = ask(svc, two, "s2")["request_id"]
    with transaction(svc.engine) as conn:
        svc.decide(conn, staff(), BAR, first, "approve")
        svc.decide(conn, staff(), BAR, second, "approve")
    slot = svc.slot_up(BAR)
    assert slot["id"] == first and slot["song_id"] == "s1" and slot["swapped"] is False
    assert svc.mark_played(BAR, first) is True
    assert status_of(svc, first) == "played"
    assert svc.slot_up(BAR)["id"] == second
    with pytest.raises(Refused) as cooldown:
        ask(svc, two, "s1")
    assert cooldown.value.code in ("cooldown", "guest_pending_limit")


def test_a_refused_request_plays_its_clean_edit_when_one_is_linked(make, content):
    class Swapping(type(content)):
        def clean_swap(self, conn, zone_id, song_id, *, directory):
            return {"s3": "s4"}.get(song_id)

    planted = Swapping()
    svc = make(content=planted)
    staffed(svc)
    request_id = ask(svc, joined(svc), "s3")["request_id"]
    with transaction(svc.engine) as conn:
        svc.decide(conn, staff(), BAR, request_id, "approve")
    planted.blocked.add("s3")
    slot = svc.slot_up(BAR)
    assert slot["song_id"] == "s4" and slot["swapped"] is True


# ---- limits --------------------------------------------------------------------------------

@pytest.mark.parametrize(("name", "low", "high"), [
    (name, low, high if high is not None else settings.PLAN_GUEST_MAX)
    for name, (low, high) in settings.RANGES.items()
])
def test_each_limit_is_tunable_only_inside_its_range(make, name, low, high):
    svc = make()
    assert configure(svc, {"limits": {name: low}})["limits"][name] == low
    assert configure(svc, {"limits": {name: high}})["limits"][name] == high
    for bad in (low - 1, high + 1):
        with pytest.raises(BusinessInvalid):
            configure(svc, {"limits": {name: bad}})


def test_the_default_limits_hold(make):
    svc = make()
    staffed(svc)
    guest = joined(svc)
    ask(svc, guest, "s1")
    with pytest.raises(Refused) as pending:
        ask(svc, guest, "s2")
    assert pending.value.code == "guest_pending_limit"
    assert configure(svc, {})["limits"] == settings.Limits().to_json()


def test_a_daypart_can_turn_requests_off(make):
    class Brunch:
        def current(self, conn, zone_id, at):
            return "brunch"

    svc = make(dayparts=Brunch())
    staffed(svc)
    configure(svc, {"daypart_modes": {"brunch": settings.OFF}})
    guest = joined(svc)
    assert svc.guest_state(guest.token)["text"] == settings.TEXT_OFF
    with pytest.raises(Refused):
        ask(svc, guest, "s1")


# ---- venue networks ------------------------------------------------------------------------

def test_five_hundred_guests_join_from_the_venue_network(make):
    svc = make(plan_guest_max=lambda conn, org: 600)  # a plan that allows 500 at once
    with transaction(svc.engine) as conn:
        svc.record_kiosk_address(conn, BAR, IP)
    code = code_of(svc)
    configure(svc, {"limits": {"guests_at_once": 500}})
    tokens = {svc.join(code, IP).token for _ in range(500)}
    assert len(tokens) == 500
    elsewhere = make()
    for _ in range(10):
        elsewhere.join(code_of(elsewhere, TERRACE), "192.0.2.50")
    with pytest.raises(Refused) as limited:
        elsewhere.join(code_of(elsewhere, TERRACE), "192.0.2.50")
    assert limited.value.status == 429


def test_code_guessing_on_the_venue_network_locks_the_visitor_not_the_venue(make, engine):
    svc = make()
    with transaction(svc.engine) as conn:
        svc.record_kiosk_address(conn, BAR, IP)
    visitor = None
    for _ in range(12):
        try:
            svc.join("ZZZZZZZZ", IP, visitor=visitor)
        except Refused as error:
            visitor = visitor or error.visitor
    with pytest.raises(Refused) as locked:
        svc.join(code_of(svc), IP, visitor=visitor)
    assert locked.value.status == 429
    assert svc.join(code_of(svc), IP).token  # everyone else on the Wi-Fi still joins
    assert "rooms.code_guessing" in activity_kinds(engine)


# ---- guest payloads, branding and abuse ----------------------------------------------------

FORBIDDEN = ("Maya", "Sam", "Bar tablet", "dev-", "billing", "licence", "device", "user-")


def test_guest_payloads_carry_no_staff_device_billing_or_licence_words(make):
    svc = make(flag_on=Flags())
    staffed(svc)
    guest = joined(svc)
    request_id = ask(svc, guest, "s1")["request_id"]
    with transaction(svc.engine) as conn:
        svc.decide(conn, tablet(), BAR, request_id, "approve")
    payloads = [svc.guest_state(guest.token), svc.search(guest.token, "Song")]
    text = json.dumps(payloads)
    for word in FORBIDDEN:
        assert word not in text, word
    branding = payloads[0]["branding"]
    assert branding["footer"] == "Powered by SelectaDJ" and branding["zone_name"] == "Bar"


def test_an_accent_that_fails_contrast_is_not_used_and_the_manager_is_told(make):
    svc = make()
    view = configure(svc, {"accent": "#777777"})
    assert view["accent_used"] is False and "4.5:1" in view["accent_reason"]
    assert configure(svc, {"accent": "#1d4ed8"})["accent_used"] is True


def test_remove_ban_pause_resume_and_the_flood_switch(make, engine, clock):
    svc = make()
    staffed(svc)
    guest = joined(svc)
    request_id = ask(svc, guest, "s1")["request_id"]
    guest_id = seen(svc)[0]["guest_id"]
    with transaction(svc.engine) as conn:
        svc.ban_guest(conn, manager(), BAR, guest_id, "day")
    assert status_of(svc, request_id) == "withdrawn"
    with pytest.raises(Refused) as banned:
        ask(svc, guest, "s2")
    assert banned.value.code == "banned"
    other = joined(svc, ip="198.51.100.20")
    with transaction(svc.engine) as conn:
        svc.set_paused(conn, staff(), BAR, True)
    assert svc.guest_state(other.token)["text"] == settings.TEXT_PAUSED
    with transaction(svc.engine) as conn:
        svc.set_paused(conn, staff(), BAR, False)
    assert svc.guest_state(other.token)["state"] == "open"
    with transaction(svc.engine) as conn:
        removed_id = svc.queue(conn, staff(), BAR) or None
        svc.remove_guest(conn, staff(), BAR, conn.execute(sa.select(guests_t.c.id).where(
            guests_t.c.nickname == other.nickname)).scalar_one())
    assert removed_id is None
    with pytest.raises(Refused) as removed:
        svc.guest_state(other.token)
    assert removed.value.status == 401
    configure(svc, {"limits": {"accepted_per_hour": 1}})  # the flood line: 3 in 10 minutes
    crowd = [joined(svc, ip=f"198.51.100.{30 + i}") for i in range(4)]
    for index, person in enumerate(crowd[:3]):
        ask(svc, person, f"s{10 + index}")
    configure(svc, {"mode": settings.AUTO_ACCEPT})
    assert ask(svc, crowd[3], "s20")["status"] == "sent"  # switched, so it waits for staff
    assert configure(svc, {})["effective_mode"] == settings.STAFF_APPROVE
    assert "rooms.flood_switch" in activity_kinds(engine)


def test_guests_are_deleted_thirty_days_after_their_last_activity(make, clock, engine):
    svc = make()
    staffed(svc)
    guest = joined(svc)
    ask(svc, guest, "s1")
    clock.advance(29 * 86400)
    assert svc.purge() == 0
    clock.advance(2 * 86400)
    assert svc.purge() == 1
    with engine.connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(requests_t)).scalar_one() == 0


def test_with_business_rooms_off_cards_say_requests_arent_available(make):
    svc = make()
    guest = joined(svc)
    off = make(flag_on=Flags({"business.rooms"}))
    assert off.guest_state(guest.token)["text"] == settings.TEXT_UNAVAILABLE
