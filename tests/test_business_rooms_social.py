"""What a standing room does together (ADR-0488, venue rooms): reactions, the vote for the next
song, dedications, the recap and patron screens, through `ZoneRooms` with a planted clock,
content rules and player."""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_business_rooms_support import BAR, PEPPER, Clock, WeekHours, code_of, manager, staff

from selecta.authz.schema import audit_events
from selecta.business.access import BusinessConflict, BusinessInvalid
from selecta.business.people.schema import business_activity
from selecta.business.rooms import social_schema as tables
from selecta.business.rooms.errors import Refused
from selecta.business.rooms.ports import Playback
from selecta.business.rooms.schema import TABLES
from selecta.business.rooms.schema import business_zone_room_requests as requests_t
from selecta.business.rooms.social import clean_settings, song_number
from selecta.persistence import make_engine, metadata, new_id, transaction
from selecta.rooms import codes
from selecta.rooms.schema import display_pairings
from selecta.rooms.schema import rooms as party_rooms
from selecta.rooms.social_schema import crowd_marks

# Share the canonical fixtures without shadowing them in test parameters.
pytest_plugins = ("test_business_rooms_support",)


@pytest.fixture
def clock():
    """The callable room-service clock, not the database clock fixture of the same name."""
    return Clock()


@pytest.fixture
def engine(tmp_path):
    """The venue tables, plus the two shared ones these features reach: the crowd marks, and
    the waiting pairings a screen makes before staff claim it."""
    built = make_engine(f"sqlite:///{tmp_path / 'rooms.sqlite'}")
    metadata.create_all(built, tables=[
        *TABLES, *tables.TABLES, crowd_marks, party_rooms, display_pairings, business_activity,
        audit_events])
    yield built
    built.dispose()


class Player:
    """The zone's player: which song is on, as the playback port says it."""

    def __init__(self) -> None:
        self.index = 1
        self.paused = False

    def state(self, conn, zone_id) -> Playback:
        return Playback(paused=self.paused, now_playing={
            "title": f"Song {self.index}", "artist": f"Artist {self.index}", "length_s": 200.0,
            "play_key": f"mix:{self.index}:{self.index}", "offset_s": 2.0})


@pytest.fixture
def room(make):
    player = Player()
    svc = make(playback=player)
    code = code_of(svc)
    with transaction(svc.engine) as conn:  # a staff member is here, so requests are open
        svc.queue(conn, staff(), BAR)
    return svc, code, player


def join(svc, code, n: int) -> str:
    return svc.join(code, f"203.0.113.{n}").token


def pulse(svc, token, code) -> dict:
    svc.forget_pulse(svc.guest_state(token, code)["room_id"])
    return svc.guest_pulse(token, code)


def test_the_pulse_names_the_song_and_offers_every_feature(room):
    svc, code, _player = room
    guest = join(svc, code, 1)
    seen = pulse(svc, guest, code)
    assert seen["song"]["title"] == "Song 1"
    assert seen["play"]["loves"] == 0 and seen["screen"] is False
    assert seen["features"] == dict.fromkeys(
        ("keeps", "reactions", "rounds", "dedications", "recap"), True)
    state = svc.guest_state(guest, code)
    assert state["social"]["reactions"] and state["now_playing"]["song_id"] == song_number(
        "Song 1", "Artist 1")
    assert {line["id"] for line in state["dedication_lines"]} >= {"birthday", "staff"}
    assert "host" not in {line["id"] for line in state["dedication_lines"]}


def test_a_love_counts_once_per_guest_and_teaches_the_zone_past_the_threshold(room, engine):
    svc, code, player = room
    guests = [join(svc, code, n) for n in range(1, 5)]
    play = pulse(svc, guests[0], code)["play"]["play_id"]
    for guest in guests[:3]:
        svc.react(guest, "love", play, True, room_key=code)
    again = svc.react(guests[0], "love", play, True, room_key=code)
    assert again["pulse"]["play"]["loves"] == 3
    assert svc.guest_state(guests[1], code)["my_taps"] == {play: ["love"]}
    with engine.connect() as conn:
        mark = conn.execute(sa.select(crowd_marks).where(crowd_marks.c.zone_key == BAR)).one()
    assert (mark.song_id, mark.next_song_id, mark.loves, mark.rooms) == (1, 0, 3, 1)
    assert svc.react(guests[0], "love", play, False, room_key=code)["pulse"]["play"]["loves"] == 2

    player.index = 2
    fresh = pulse(svc, guests[0], code)
    assert fresh["play"]["blend"]["from"]["title"] == "Song 1"
    svc.react(guests[3], "love", play, True, room_key=code)  # just after the song changed
    with pytest.raises(Refused) as stale:
        svc.react(guests[0], "love", "no-such-play", True, room_key=code)
    assert stale.value.code == "song_changed"


def test_a_feature_switched_off_is_refused_and_leaves_the_pulse(room):
    svc, code, _player = room
    guest = join(svc, code, 1)
    play = pulse(svc, guest, code)["play"]["play_id"]
    with transaction(svc.engine) as conn:
        view = svc.update_social(conn, manager(), BAR, {"reactions": False, "nope": 1})
    assert view["settings"]["reactions"] is False and "nope" not in view["settings"]
    with pytest.raises(Refused) as refused:
        svc.react(guest, "love", play, True, room_key=code)
    assert refused.value.code == "feature_off"
    assert pulse(svc, guest, code)["features"]["reactions"] is False
    with pytest.raises(BusinessInvalid):
        clean_settings({}, {"keeps": "yes"})
    assert clean_settings({}, {"round_every_songs": 1, "round_seconds": 999}) | {} == {
        **clean_settings({}, {}), "round_every_songs": 2, "round_seconds": 120}


def test_the_room_votes_and_the_winner_is_the_next_request(room, content):
    svc, code, _player = room
    guests = [join(svc, code, n) for n in range(1, 5)]
    content.blocked.add("s2")
    with transaction(svc.engine) as conn:
        started = svc.start_round(conn, staff(), BAR)
        with pytest.raises(BusinessConflict):
            svc.start_round(conn, staff(), BAR)
    offered = [option["song_id"] for option in started["options"]]
    assert len(offered) == 3 and not {"s2", "blocked", "explicit", "fast"} & set(offered)
    round_id = started["round_id"]
    svc.cast_round_vote(guests[0], round_id, 0, room_key=code)
    svc.cast_round_vote(guests[1], round_id, 1, room_key=code)
    svc.cast_round_vote(guests[2], round_id, 1, room_key=code)
    voted = svc.cast_round_vote(guests[0], round_id, 2, room_key=code)  # changes their mind
    assert [o["votes"] for o in voted["pulse"]["round"]["options"]] == [0, 2, 1]
    assert svc.guest_state(guests[1], code)["my_vote"] == {
        "round_id": round_id, "position": 1, "can_vote": True}
    svc.clock.advance(5)
    late = join(svc, code, 9)
    with pytest.raises(Refused) as too_late:
        svc.cast_round_vote(late, round_id, 0, room_key=code)
    assert too_late.value.code == "joined_late"
    with pytest.raises(Refused) as wrong:
        svc.cast_round_vote(guests[3], round_id, 3, room_key=code)
    assert wrong.value.code == "not_an_option"

    svc.clock.advance(60)
    closed = pulse(svc, guests[0], code)["round"]
    assert closed["state"] == "closed" and closed["winner"] == 1
    assert closed["outcome"] == "waiting"
    up = svc.slot_up(BAR)
    assert up["song_id"] == offered[1]
    assert svc.mark_played(BAR, up["id"])
    assert pulse(svc, guests[0], code)["round"]["outcome"] == "in_mix"
    with pytest.raises(Refused):
        svc.cast_round_vote(guests[3], round_id, 0, room_key=code)


def test_a_vote_nobody_votes_in_has_no_winner_and_one_can_be_called_off(room):
    svc, code, _player = room
    guest = join(svc, code, 1)
    with transaction(svc.engine) as conn:
        first = svc.start_round(conn, staff(), BAR)
    svc.clock.advance(60)
    done = pulse(svc, guest, code)["round"]
    assert (done["state"], done["winner"], done["outcome"]) == ("void", None, "no_votes")
    with transaction(svc.engine) as conn:
        second = svc.start_round(conn, staff(), BAR)
        assert second["round_id"] != first["round_id"]
        assert svc.cancel_round(conn, staff(), BAR, second["round_id"])["state"] == "cancelled"


def test_a_vote_starts_by_itself_every_so_many_songs(room):
    svc, code, player = room
    guest = join(svc, code, 1)
    with transaction(svc.engine) as conn:
        svc.update_social(conn, manager(), BAR, {"round_every_songs": 2})
    assert pulse(svc, guest, code)["round"] is None  # one song so far
    player.index = 2
    svc.clock.advance(200)
    svc.guest_state(guest, code)  # the guest's page is still open
    assert pulse(svc, guest, code)["round"]["state"] == "open"


def test_a_dedication_is_a_listed_line_on_your_own_request_and_shows_once(room):
    svc, code, player = room
    asker, other = join(svc, code, 1), join(svc, code, 2)
    with transaction(svc.engine) as conn:
        svc.update_settings(conn, manager(), BAR, {"mode": "auto_accept"})
    placed = svc.place(asker, "s2", room_key=code)["request_id"]
    assert svc.set_dedication(asker, placed, "birthday", room_key=code)["dedication"] == "birthday"
    for refused, line, who in (
        ("no_such_line", "host", asker),
        ("no_such_line", "typed words", asker),
        ("no_such_request", "cheers", other),
    ):
        with pytest.raises(Refused) as error:
            svc.set_dedication(who, placed, line, room_key=code)
        assert error.value.code == refused
    assert svc.guest_state(asker, code)["my_dedications"][placed]["words"] == "Happy birthday!"
    assert pulse(svc, asker, code).get("dedication") is None  # Song 1 is on
    player.index = 2
    shown = pulse(svc, other, code)["dedication"]
    assert (shown["words"], shown["from"]) == ("Happy birthday!", None)
    with transaction(svc.engine) as conn:
        svc.update_social(conn, manager(), BAR, {"dedications_hidden": ["birthday"]})
    assert pulse(svc, other, code)["dedication"] is None
    with transaction(svc.engine) as conn:
        svc.update_social(conn, manager(), BAR, {"dedications_hidden": []})
        assert svc.clear_dedication(conn, staff(), BAR, placed)["dedication"] is None
    assert pulse(svc, other, code)["dedication"] is None


def test_the_recap_is_totals_only_and_guests_see_it_once_the_zone_has_closed(make):
    player = Player()
    hours = WeekHours()
    svc = make(playback=player, hours=hours)
    code = code_of(svc)
    with transaction(svc.engine) as conn:
        svc.queue(conn, staff(), BAR)
    guests = [join(svc, code, n) for n in range(1, 5)]
    play = pulse(svc, guests[0], code)["play"]["play_id"]
    for guest in guests[:3]:
        svc.react(guest, "love", play, True, room_key=code)
    assert svc.guest_recap(guests[0], code) == {"recap": None, "lines": []}  # still open
    with transaction(svc.engine) as conn:
        built = svc.recap_view(conn, staff(), BAR)
    assert built["recap"]["guests"] == 4 and built["recap"]["loved"][0]["loves"] == 3
    assert not any("Sam" in line or "Maya" in line for line in built["lines"])
    svc.clock.advance(9 * 3600)  # 03:00, after closing
    after = svc.guest_recap(guests[0], code)
    assert after["lines"][0] == "Bar: tonight in numbers"


def test_a_patron_screen_pairs_to_a_zone_and_only_counts_while_it_looks(room, engine):
    svc, code, _player = room
    guest = join(svc, code, 1)
    token, pairing = codes.new_token(), "ABC234"
    with transaction(engine) as conn:
        conn.execute(display_pairings.insert().values(
            id=new_id(), workspace_id=None, room_id=None,
            pairing_code_hash=codes.pairing_hash(pairing, PEPPER),
            token_hash=codes.token_hash(token), created_at=svc.clock(),
            expires_at=svc.clock() + 600))
    assert svc.screen_view(token) is None  # not a venue screen until staff pair it
    with transaction(engine) as conn:
        paired = svc.pair_screen(conn, manager(), BAR, pairing)
    assert len(paired["screens"]) == 1 and paired["screens"][0]["online"] is False
    assert pulse(svc, guest, code)["screen"] is False  # paired, but it has not looked
    view = svc.screen_view(token)
    assert view["state"] == "paired" and view["join_path"].endswith("?at=venue")
    assert view["room_name"] == "The Crown · Bar" and view["now_playing"]["title"] == "Song 1"
    assert pulse(svc, guest, code)["screen"] is True
    svc.clock.advance(45)
    assert pulse(svc, guest, code)["screen"] is False  # switched off: nothing waits for it
    assert svc.unpair_self(token) and svc.screen_view(token) is None


def test_a_banned_or_idle_guest_takes_their_taps_with_them(room, engine):
    svc, code, _player = room
    guest = join(svc, code, 1)
    play = pulse(svc, guest, code)["play"]["play_id"]
    svc.react(guest, "love", play, True, room_key=code)
    svc.clock.advance(31 * 86400)
    assert svc.purge() == 1
    with engine.connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(requests_t)).scalar_one() == 0
        assert conn.execute(sa.select(sa.func.count()).select_from(tables.reactions)
                            ).scalar_one() == 0
