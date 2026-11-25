"""What a party room does together (ADR-0488): plays, the pulse and the phone-first screen rule,
reactions and crowd marks, the vote for the next song, dedications, and tonight in numbers."""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_cloud_rooms_fakes import HOST, FakeNowPlaying, follow_clock, make_rooms, request_rows

from selecta.persistence import transaction
from selecta.rooms import dedications, plays, reactions, recap, rounds
from selecta.rooms.api_social import Social
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.host_features import SOCIAL, HostFeatures, offered, on_screen
from selecta.rooms.ports import NowPlaying
from selecta.rooms.settings import RoomSettings
from selecta.rooms.social_schema import crowd_marks, room_plays, room_reactions, room_recaps
from selecta.rooms.views import DISPLAY_ONLINE_SECONDS
from selecta.roomsocial import recap as recap_rules
from selecta.roomsocial import rounds as round_rules


class Deck(FakeNowPlaying):
    """A now-playing source that says where in the mix the speaker is, as the session does."""

    def __init__(self, catalog) -> None:
        super().__init__()
        self.catalog = catalog
        self.index = 0
        self.state = "playing"

    def now_playing(self, workspace_id: str) -> NowPlaying:
        song = self.catalog.songs[self.index + 1]
        return NowPlaying(song, (), self.state, "mix", self.index, 2.0)


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


@pytest.fixture
def party(engine):
    rooms = make_rooms(engine)
    rooms.now_playing = Deck(rooms.catalog)
    opened = rooms.open_room(HOST, "Party")
    guests = [rooms.join(opened.code, rooms.hash_ip(f"203.0.113.{n}")) for n in range(1, 5)]
    return rooms, opened, guests


def _refused(refusal: Refusal, call, *args, **kwargs) -> None:
    with pytest.raises(RoomError) as caught:
        call(*args, **kwargs)
    assert caught.value.refusal is refusal


def _pulse(rooms, opened) -> dict:
    """The pulse as a phone or a screen reads it, made fresh (no second-long cache)."""
    social = Social(lambda: rooms, HostFeatures(lambda: rooms.engine, None))
    return social.pulse(HOST, opened.room.id)


def _play_id(rooms, opened) -> str:
    return _pulse(rooms, opened)["play"]["play_id"]


# ---- settings and the screen rule ----------------------------------------------------------


def test_the_five_are_on_by_default_and_each_needs_its_flag_and_its_setting():
    settings = RoomSettings()
    every = dict.fromkeys(SOCIAL.values(), True)
    assert offered(settings, every) == dict.fromkeys(SOCIAL, True)
    assert offered(settings, {**every, "rooms.rounds": False})["rounds"] is False
    quiet = RoomSettings.from_json({"reactions": False, "screen_rounds": False})
    features = offered(quiet, every)
    assert features["reactions"] is False and features["keeps"] is True
    shows = on_screen(quiet, features)
    assert shows == {"rounds": False, "reactions": False, "dedications": True, "recap": True}


def test_settings_clamp_the_vote_and_drop_lines_the_list_does_not_have():
    settings = RoomSettings.from_json(
        {"round_seconds": 5, "round_every_songs": 1, "dedications_hidden": ["road", "typed"]}
    )
    assert (settings.round_seconds, settings.round_every_songs) == (30, 2)
    assert settings.dedications_hidden == ("road",)
    assert RoomSettings.from_json(settings.to_json()) == settings
    with pytest.raises(ValueError):
        RoomSettings.from_json({"keeps": "yes"})


def test_a_screen_counts_only_while_it_is_paired_and_has_just_looked(party, clock):
    rooms, opened, guests = party
    assert _pulse(rooms, opened)["screen"] is False
    assert rooms.guest_view(guests[0].guest_token).screen is False
    screen = rooms.start_pairing()
    rooms.confirm_pairing(HOST, opened.room.id, screen.pairing_code)
    assert _pulse(rooms, opened)["screen"] is False  # paired, but it has not looked yet
    rooms.display_view(screen.display_token)
    assert _pulse(rooms, opened)["screen"] is True
    assert rooms.guest_view(guests[0].guest_token).screen is True
    clock.advance(DISPLAY_ONLINE_SECONDS + 1)
    assert _pulse(rooms, opened)["screen"] is False  # switched off: nothing waits for it


# ---- plays ---------------------------------------------------------------------------------


def test_each_song_is_one_play_and_a_loaded_song_that_has_not_played_is_none(party, engine):
    rooms, opened, _guests = party
    deck = rooms.now_playing
    deck.state = "paused"
    seen = _pulse(rooms, opened)
    assert seen["song"]["title"] == "Song 1" and seen["paused"] and seen["play"] is None
    deck.state = "playing"
    first = _play_id(rooms, opened)
    assert _play_id(rooms, opened) == first  # a second look is the same play
    deck.index = 1
    second = _pulse(rooms, opened)
    assert second["play"]["play_id"] != first
    assert second["play"]["blend"]["from"]["title"] == "Song 1"
    deck.index = 0
    assert _play_id(rooms, opened) == first  # going back finds its row again
    room = rooms.current_room(HOST)
    with transaction(engine, HOST) as conn:
        assert plays.count_plays(conn, room) == 2


def test_a_paused_song_reads_as_paused_on_the_guest_page_and_the_screen(party):
    rooms, opened, guests = party
    rooms.now_playing.state = "paused"
    view = rooms.guest_view(guests[0].guest_token)
    assert view.now_playing.title == "Song 1" and view.music_paused is True
    screen = rooms.start_pairing()
    rooms.confirm_pairing(HOST, opened.room.id, screen.pairing_code)
    shown = rooms.display_view(screen.display_token)
    assert shown.now_playing.title == "Song 1" and shown.music_paused is True


# ---- reactions -----------------------------------------------------------------------------


def test_a_love_counts_once_per_guest_and_can_be_taken_back(party, engine):
    rooms, opened, guests = party
    play = _play_id(rooms, opened)
    for guest in guests[:3]:
        reactions.react(rooms, guest.guest_token, "love", play)
    assert reactions.react(rooms, guests[0].guest_token, "love", play).loves == 3
    with transaction(engine, HOST) as conn:
        mine = reactions.mine(conn, opened.room.id, guests[1].guest_id, [play])
        marks = reactions.loved_songs(conn, HOST)
    assert mine == {play: {"love"}}
    assert marks == [{"song_id": 1, "next_song_id": None, "loves": 3, "rooms": 1,
                      "last_at": marks[0]["last_at"]}]
    assert reactions.unreact(rooms, guests[0].guest_token, "love", play).loves == 2


def test_one_guest_alone_teaches_the_planner_nothing(party, engine):
    rooms, opened, guests = party
    reactions.react(rooms, guests[0].guest_token, "love", _play_id(rooms, opened))
    with transaction(engine, HOST) as conn:
        mark = conn.execute(sa.select(crowd_marks.c.loves, crowd_marks.c.rooms)).one()
    assert tuple(mark) == (1, 0)


def test_a_late_tap_counts_for_the_song_just_gone_and_an_old_one_is_refused(party, clock):
    rooms, opened, guests = party
    first = _play_id(rooms, opened)
    rooms.now_playing.index = 1
    clock.advance(200)
    second = _play_id(rooms, opened)
    assert reactions.react(rooms, guests[0].guest_token, "love", first).loves == 1
    for guest in guests[:2]:
        reactions.react(rooms, guest.guest_token, "blend", second)
    clock.advance(plays.BLEND_WINDOW_SECONDS + 1)
    _refused(Refusal.SONG_CHANGED, reactions.react, rooms, guests[2].guest_token, "blend", second)
    _refused(Refusal.SONG_CHANGED, reactions.react, rooms, guests[2].guest_token, "love", first)
    _refused(Refusal.SONG_CHANGED, reactions.react, rooms, guests[2].guest_token, "love", "nope")


def test_reactions_off_refuses_a_tap_and_a_ban_takes_taps_back(party, engine):
    rooms, opened, guests = party
    play = _play_id(rooms, opened)
    for guest in guests[:2]:
        reactions.react(rooms, guest.guest_token, "love", play)
    rooms.ban_guest(HOST, opened.room.id, guests[0].guest_id)
    assert _pulse(rooms, opened)["play"]["loves"] == 1
    with transaction(engine, HOST) as conn:
        left = conn.execute(sa.select(sa.func.count()).select_from(room_reactions)).scalar_one()
    assert left == 1
    rooms.update_settings(HOST, opened.room.id, {"reactions": False}, partial=True)
    _refused(Refusal.FEATURE_OFF, reactions.react, rooms, guests[1].guest_token, "love", play)
    assert _pulse(rooms, opened)["play"]["loves"] == 0  # counts are not shown while it is off


# ---- pick the next song --------------------------------------------------------------------


def test_the_room_votes_and_the_winner_goes_to_the_planner_with_no_asker(party, clock):
    rooms, opened, guests = party
    room_id = opened.room.id
    voting = rounds.open_round(rooms, HOST, room_id, [5, 6, 6, 7, True, "x"])
    assert [option.song_id for option in voting.options] == [5, 6, 7]
    _refused(Refusal.ROUND_OPEN, rounds.open_round, rooms, HOST, room_id, [8, 9])
    rounds.cast(rooms, guests[0].guest_token, voting.id, 0)
    rounds.cast(rooms, guests[1].guest_token, voting.id, 1)
    rounds.cast(rooms, guests[2].guest_token, voting.id, 1)
    changed = rounds.cast(rooms, guests[0].guest_token, voting.id, 2)  # changes their mind
    assert [option.votes for option in changed.options] == [0, 2, 1]
    clock.advance(5)
    late = rooms.join(opened.code, rooms.hash_ip("203.0.113.99"))
    _refused(Refusal.JOINED_LATE, rounds.cast, rooms, late.guest_token, voting.id, 0)
    _refused(Refusal.NOT_AN_OPTION, rounds.cast, rooms, guests[3].guest_token, voting.id, 9)
    assert rounds.settle_due(rooms, HOST, room_id) is None  # its time is not up

    clock.advance(60)
    closed = rounds.settle_due(rooms, HOST, room_id)
    assert (closed.status, closed.winner_song_id, closed.outcome) == ("closed", 6, "waiting")
    assert rounds.settle_due(rooms, HOST, room_id) is None  # closing twice changes nothing
    assert rooms.planner.submitted[-1]["song_id"] == 6
    assert rooms.planner.submitted[-1]["guest_id"] is None
    row = next(row for row in request_rows(rooms.engine) if row["song_id"] == 6)
    assert (row["source"], row["status"], row["guest_id"]) == ("round", "accepted", None)
    shown = _pulse(rooms, opened)["round"]
    assert shown["state"] == "closed" and shown["winner"] == 1
    _refused(Refusal.NO_ROUND, rounds.cast, rooms, guests[3].guest_token, voting.id, 0)
    clock.advance(rounds.RESULT_SECONDS + 1)
    assert _pulse(rooms, opened)["round"] is None


def test_nobody_voting_or_the_leader_gone_and_calling_it_off(party, clock):
    rooms, opened, guests = party
    room_id = opened.room.id
    rounds.open_round(rooms, HOST, room_id, [5, 6])
    clock.advance(60)
    assert rounds.settle_due(rooms, HOST, room_id).outcome == "no_votes"
    second = rounds.open_round(rooms, HOST, room_id, [5, 6, 7])
    rounds.cast(rooms, guests[0].guest_token, second.id, 0)
    rounds.cast(rooms, guests[1].guest_token, second.id, 0)
    rounds.cast(rooms, guests[2].guest_token, second.id, 1)
    rooms.catalog.not_ready.add(5)
    clock.advance(60)
    assert rounds.settle_due(rooms, HOST, room_id).winner_song_id == 6
    third = rounds.open_round(rooms, HOST, room_id, [8, 9])
    rounds.cast(rooms, guests[3].guest_token, third.id, 1)
    rooms.ban_guest(HOST, room_id, guests[3].guest_id)
    room = rooms.current_room(HOST)
    with transaction(rooms.engine, HOST) as conn:
        tally = rounds.open_round_of(conn, room).options
    assert [option.votes for option in tally] == [0, 0]
    assert rounds.cancel(rooms, HOST, room_id, third.id).status == "cancelled"


def test_a_vote_needs_two_playable_songs_a_speaker_and_the_feature(party):
    rooms, opened, _guests = party
    room_id = opened.room.id
    _refused(Refusal.TOO_FEW_SONGS, rounds.open_round, rooms, HOST, room_id, [5])
    _refused(Refusal.TOO_FEW_SONGS, rounds.open_round, rooms, HOST, room_id, [5, 9999])
    rooms.speakers.offline.add(HOST)
    _refused(Refusal.NO_SPEAKER, rounds.open_round, rooms, HOST, room_id, [5, 6])
    _refused(Refusal.NO_SPEAKER, rounds.want_round, rooms, HOST, room_id)
    rooms.speakers.offline.clear()
    rounds.want_round(rooms, HOST, room_id)
    assert rooms.events.events[-1][2:] == ("room.round", {"state": "wanted", "opened_by": "host"})
    rooms.update_settings(HOST, room_id, {"rounds": False}, partial=True)
    _refused(Refusal.FEATURE_OFF, rounds.open_round, rooms, HOST, room_id, [5, 6])


def test_a_tie_is_broken_the_same_way_for_every_reader():
    option = round_rules.Option
    options = [option(0, 5, 2), option(1, 6, 2), option(2, 7, 0)]
    first = round_rules.winner("round-a", options)
    assert first == round_rules.winner("round-a", list(reversed(options)))
    assert round_rules.winner("round-a", [round_rules.Option(0, 5, 0)]) is None
    assert round_rules.winner("round-a", options, still_playable=[7]) is None
    with pytest.raises(ValueError):
        round_rules.clean_options([5, 5])


def test_the_timer_asks_once_on_the_nth_song_while_someone_is_here(party, clock):
    rooms, opened, guests = party
    rooms.update_settings(HOST, opened.room.id, {"round_every_songs": 2}, partial=True)

    def asked() -> list[dict]:
        return [payload for _ws, _room, kind, payload in rooms.events.events
                if kind == "room.round" and payload.get("state") == "wanted"]

    clock.advance(10)  # the first song starts after the room opened
    _play_id(rooms, opened)
    assert asked() == []  # one song so far
    rooms.now_playing.index = 1
    clock.advance(200)
    rooms.guest_view(guests[0].guest_token)  # a guest's page is still open
    _play_id(rooms, opened)
    assert asked() == [{"state": "wanted", "opened_by": "timer"}]
    _play_id(rooms, opened)
    assert len(asked()) == 1  # asked once for this song

# ---- dedications ---------------------------------------------------------------------------


def test_a_dedication_is_a_listed_line_on_your_own_request_and_shows_once(party, clock):
    rooms, opened, guests = party
    asked = rooms.request(guests[0].guest_token, 2).request
    assert dedications.set_line(rooms, guests[0].guest_token, asked.id, "birthday").dedication
    for line in ("typed words", "staff"):
        _refused(Refusal.NO_SUCH_LINE, dedications.set_line, rooms, guests[0].guest_token,
                 asked.id, line)
    _refused(Refusal.NO_SUCH_REQUEST, dedications.set_line, rooms, guests[1].guest_token,
             asked.id, "cheers")
    assert _pulse(rooms, opened).get("dedication") is None  # Song 1 is on
    rooms.now_playing.index = 1
    clock.advance(200)
    shown = _pulse(rooms, opened)["dedication"]
    assert (shown["words"], shown["from"]) == ("Happy birthday!", None)  # names are hidden
    rooms.update_settings(HOST, opened.room.id, {"names_shown": True}, partial=True)
    assert _pulse(rooms, opened)["dedication"]["from"] == guests[0].nickname
    rooms.now_playing.index = 2
    clock.advance(200)
    assert _pulse(rooms, opened)["dedication"] is None
    rooms.now_playing.state, rooms.now_playing.index = "playing", 1
    with transaction(rooms.engine, HOST) as conn:  # the same song later in the night
        conn.execute(sa.update(room_plays).where(room_plays.c.song_id == 2).values(mix_key="old"))
    clock.advance(200)
    assert _pulse(rooms, opened)["dedication"] is None
    assert dedications.host_clear(rooms, HOST, opened.room.id, asked.id).dedication is None


# ---- tonight in numbers --------------------------------------------------------------------


def test_the_recap_is_built_once_totals_only_and_outlives_the_purge(party, clock, engine):
    rooms, opened, guests = party
    room_id = opened.room.id
    play = _play_id(rooms, opened)
    for guest in guests[:3]:
        reactions.react(rooms, guest.guest_token, "love", play)
    rooms.request(guests[0].guest_token, 3)
    assert recap.recap_of(rooms, HOST, room_id) is None  # still open
    clock.advance(1800)
    rooms.end_room(HOST, room_id)
    built = recap.recap_of(rooms, HOST, room_id)
    assert built["guests"] == 4 and built["minutes"] == 30 and built["songs_played"] == 1
    assert built["loved"] == [{"title": "Song 1", "artist": "Artist 1", "song_id": 1, "loves": 3}]
    words = " ".join(recap_rules.lines(built))
    assert not any(guest.nickname in words for guest in guests)
    assert recap.recap_of(rooms, HOST, room_id) == built
    clock.advance(40 * 86400)
    rooms.purge_guest_data()
    with transaction(engine, HOST) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(room_plays)).scalar_one() == 0
        assert conn.execute(sa.select(sa.func.count()).select_from(room_recaps)).scalar_one() == 1
    assert recap.recap_of(rooms, HOST, room_id) == built


def test_two_guests_see_no_loved_lines_and_an_empty_room_has_no_recap():
    few = recap_rules.build(name="Small", started_at=0, ended_at=600, guests=2, songs_played=3,
                            requests_asked=0, requests_played=0, votes=0,
                            loved=[{"title": "A", "artist": "B", "loves": 2}])
    assert "loved" not in few and few["songs_played"] == 3 and "votes" not in few
    assert recap_rules.build(name="Empty", started_at=0, ended_at=600, guests=0, songs_played=9,
                             requests_asked=0, requests_played=0, votes=0) is None
