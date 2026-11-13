"""LF09 model simulations. These are NOT physical output verification."""
from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
import hashlib
from pathlib import Path

import pytest

from selecta.lf_venue import (Daypart, Limits, Opening, OutputProbe, Policy,
                              Recording, Venue, VenueEngine, VenueError, VenueStore, Zone)


class Authority:
    def __init__(self):
        self.allowed = True

    def authorised(self, workspace_id, venue_id, engine_id):
        return self.allowed and workspace_id == 'w' and engine_id == 'local-device'


class Audio:
    def __init__(self):
        self.playing = {}
        self.missing_outputs = set()
        self.silent_outputs = set()
        self.prepared = []
        self.fail_start = False
        self.fail_stop = False

    def preflight(self, zone, recording):
        return True

    def prepare(self, zone, recording, prior):
        self.prepared.append((zone.id, recording.track_id, prior.track_id if prior else None))
        return f'dsp/{zone.id}/{recording.track_id}/{recording.revision}'

    def start(self, zone, recording, handle, generation, position_s):
        if self.fail_start or zone.output_id in self.missing_outputs:
            return False
        self.playing[zone.id] = (recording.track_id, generation, position_s)
        return True

    def stop(self, zone, generation):
        if self.fail_stop:
            return False
        self.playing.pop(zone.id, None)
        return True

    def probe(self, zone):
        connected = zone.output_id not in self.missing_outputs
        active = zone.id in self.playing
        return OutputProbe(connected, active, connected and active and zone.output_id not in self.silent_outputs, latency_ms=20)


@pytest.fixture
def fixture(tmp_path):
    epoch = datetime(2026, 11, 13, 21, tzinfo=UTC).timestamp()
    clock = [epoch]
    store = VenueStore(tmp_path / 'speaker.sqlite3')
    audio = Audio()
    authority = Authority()
    service = VenueEngine(store, audio, authority, Limits(cpu_cores=6, memory_mb=4096), clock=lambda: clock[0])
    root = tmp_path / 'music'
    root.mkdir()
    def register(venue, track_id, *, artist='Safe Artist', explicit=False, source='licensed', duration=220):
        file = root / f'{venue}-{track_id}.wav'
        file.write_bytes(b'RIFF\x00test synthetic audio ' + track_id.encode())
        recording = Recording(track_id, str(file), source, artist, explicit, duration, 'v1', hashlib.sha256(file.read_bytes()).hexdigest())
        service.register_local('w', venue, recording)
        return file
    def configure(venue='v', zones=None, policy=None, hours=None):
        entry = Venue('w', venue, 'local-device', 'Europe/London',
                      tuple(hours if hours is not None else [Opening(i, '00:00', '00:00', True) for i in range(7)]),
                      tuple(zones or (Zone('bar', 'dac-1', allowed_sources=('licensed',)),)),
                      policy or Policy(rights_attested=True, allow_requests=True, fallback_ids=('safe',)),
                      (str(root),))
        service.configure(entry)
        return entry
    return clock, store, audio, authority, service, configure, register


def test_offline_six_hours_and_reconcile_deduplicates(fixture):
    clock, store, audio, _, service, configure, register = fixture
    configure(policy=Policy(rights_attested=True, repeat_after_seconds=3600))
    songs = [f'track-{i:02d}' for i in range(40)]
    for track in songs:
        register('v', track, duration=600)
    service.plan('w', 'v', 'bar', songs)
    assert len(service.prepare('w', 'v', 'bar')) >= 3
    assert service.start('w', 'v', 'bar')
    # Offline for SIX HOURS, including 36 *real* local track-end callbacks.
    for tick in range(36):
        clock[0] += 600
        assert service.tick('w', 'v', 'bar', position_s=599).actual_output == 'audible_verified'
        generation = store.session('w', 'v', 'bar')['generation']
        audio.playing.pop('bar')  # local audio engine confirms track end
        assert service.ended('w', 'v', 'bar', generation=generation)
        service.prepare('w', 'v', 'bar')  # incrementally top up the local prepared horizon
    assert service.diagnose('w', 'v', 'bar').state == 'playing'
    events = store.pending_events('w', 'v')
    assert len(events) == 73  # 37 acknowledged starts + 36 ends
    assert 'local_path' not in repr(events)
    ids = [e['event_id'] for e in events]
    assert len(ids) == len(set(ids))
    assert store.acknowledge_events('w', 'v', ids + ids) == len(events)
    assert store.pending_events('w', 'v') == []
    assert store.append_ack('w', 'v', 'bar', event_id=ids[0], kind='started',
                             track='track-00', at=clock[0], generation=1) is False


def test_twenty_venues_different_inventories(fixture):
    _, _, _, _, service, configure, register = fixture
    for i in range(20):
        venue = f'venue-{i}'
        configure(venue, [Zone('zone', f'usb-{i}', allowed_sources=('licensed',))])
        register(venue, 'same-metadata-id') if i % 2 == 0 else None
        service.plan('w', venue, 'zone', ['same-metadata-id'])
        prepared = service.prepare('w', venue, 'zone')
        assert bool(prepared) is (i % 2 == 0)
        if i % 2:
            assert service.diagnose('w', venue, 'zone').missing_sources == ('same-metadata-id', 'safe')


def test_two_zones_output_admission_and_isolation(fixture):
    _, store, audio, _, service, configure, register = fixture
    zones = (Zone('bar', 'dac-1', allowed_sources=('licensed',)), Zone('lounge', 'dac-2', allowed_sources=('licensed',)))
    configure(zones=zones)
    register('v', 'one')
    for zone in zones:
        service.plan('w', 'v', zone.id, ['one'])
        service.prepare('w', 'v', zone.id)
        assert service.start('w', 'v', zone.id)
    assert audio.playing['bar'][0] == audio.playing['lounge'][0] == 'one'
    assert len(store.pending_events('w', 'v')) == 2
    with pytest.raises(VenueError, match='active'):
        configure(zones=(Zone('bar', 'dac-1'), Zone('lounge', 'dac-1')))
    service.stop('w', 'v', 'bar')
    service.stop('w', 'v', 'lounge')
    with pytest.raises(VenueError, match='channel'):
        configure(zones=(Zone('bar', 'dac-1'), Zone('lounge', 'dac-1')))
    # Explicit multichannel non-overlapping channels are allowed.
    configure(zones=(Zone('bar', '8-channel', channels=(0, 1)), Zone('lounge', '8-channel', channels=(2, 3))))


def test_policy_change_during_playback(fixture):
    clock, store, audio, _, service, configure, register = fixture
    venue = configure()
    register('v', 'one', artist='Artist Now Blocked')
    service.plan('w', 'v', 'bar', ['one'])
    service.prepare('w', 'v', 'bar')
    assert service.start('w', 'v', 'bar')
    configure(policy=replace(venue.policy, blocked_artists=('artist now blocked',)))
    assert service.tick('w', 'v', 'bar').state == 'stopped'
    assert audio.playing == {}
    assert service.prepare('w', 'v', 'bar') == ()  # blocked artist never prepared again


def test_missing_source_no_cloud_substitution_and_policy(fixture):
    clock, store, audio, _, service, configure, register = fixture
    configure(policy=Policy(rights_attested=True, fallback_ids=('safe',), repeat_after_seconds=60))
    file = register('v', 'safe', explicit=False)
    register('v', 'explicit', explicit=True)
    service.plan('w', 'v', 'bar', ['explicit', 'safe'])
    assert service.prepare('w', 'v', 'bar') == ('safe',)
    assert service.request_eligible('w', 'v', 'bar', 'safe') is False
    file.unlink()
    assert service.prepare('w', 'v', 'bar') == ()
    assert service.diagnose('w', 'v', 'bar').missing_sources == ('explicit', 'safe')
    assert service.start('w', 'v', 'bar') is False


def test_power_recovery_requires_safe_clock_rights_output_and_fencing(fixture):
    clock, store, audio, authority, service, configure, register = fixture
    configure()
    register('v', 'one')
    service.plan('w', 'v', 'bar', ['one'])
    service.prepare('w', 'v', 'bar')
    assert service.start('w', 'v', 'bar')
    old = store.session('w', 'v', 'bar')['generation']
    audio.playing.clear()  # power cycle, no physical output
    clock[0] += 5
    assert service.recover('w', 'v', 'bar')
    assert store.session('w', 'v', 'bar')['generation'] > old
    assert not service.ended('w', 'v', 'bar', generation=old)  # old decoder callback fenced
    audio.playing.clear()
    clock[0] -= 300
    with pytest.raises(VenueError, match='clock'):
        service.recover('w', 'v', 'bar')
    clock[0] += 300
    authority.allowed = False
    with pytest.raises(VenueError, match='authority'):
        service.recover('w', 'v', 'bar')


def test_output_disconnect_and_unconfirmed_release(fixture):
    _, store, audio, _, service, configure, register = fixture
    configure()
    register('v', 'one')
    service.plan('w', 'v', 'bar', ['one'])
    service.prepare('w', 'v', 'bar')
    assert service.start('w', 'v', 'bar')
    audio.missing_outputs.add('dac-1')
    assert service.tick('w', 'v', 'bar').state == 'unknown'
    audio.fail_stop = True
    assert service.stop('w', 'v', 'bar') is False
    assert store.session('w', 'v', 'bar')['state'] == 'unknown'


def test_dst_and_overnight_openings(fixture):
    clock, _, _, _, service, configure, register = fixture
    from datetime import timedelta
    opening = Opening(4, '18:00', '02:00')
    venue = configure(hours=[opening])
    for stamp, expected in [('2026-11-14T01:30:00+00:00', True),
                            ('2026-11-14T03:00:00+00:00', False),
                            ('2026-11-13T17:00:00+00:00', False)]:
        assert venue.open_at(datetime.fromisoformat(stamp).timestamp()) is expected
    fall = configure('fall', zones=[Zone('bar', 'dac-fall')], hours=[Opening(6, '00:30', '02:30')])
    for stamp in ('2026-10-25T00:40:00+00:00', '2026-10-25T01:40:00+00:00'):
        assert fall.open_at(datetime.fromisoformat(stamp).timestamp())
    spring = configure('spring', zones=[Zone('bar', 'dac-spring')], hours=[Opening(6, '01:30', '03:00')])
    assert spring.open_at(datetime.fromisoformat('2026-03-29T01:30:00+00:00').timestamp())
    assert not spring.open_at(datetime.fromisoformat('2026-03-29T00:30:00+00:00').timestamp())


def test_budget_blocks_starving_foreground(fixture):
    _, store, _, _, service, configure, register = fixture
    configure()
    register('v', 'a')
    service.plan('w', 'v', 'bar', ['a'])
    service.prepare('w', 'v', 'bar')
    service.start('w', 'v', 'bar')
    assert service.admit_background('w', 'v') == (0, 0)
    with pytest.raises(VenueError, match='CPU'):
        service.configure(replace(store.config('w', 'v'), zones=(Zone('bar', 'dac-1', cpu_cores=10),)))


def test_rights_expiry_enforced_offline(fixture):
    clock, store, audio, _, service, configure, register = fixture
    configure(policy=Policy(rights_attested=True, rights_until=clock[0]+120))
    register('v', 'one')
    service.plan('w', 'v', 'bar', ['one'])
    service.prepare('w', 'v', 'bar')
    assert service.start('w', 'v', 'bar')
    clock[0] += 121
    health = service.tick('w', 'v', 'bar')
    assert health.state == 'stopped' and not audio.playing
    assert not service.recover('w', 'v', 'bar')


def test_replay_fenced_and_unconfirmed_output_never_journalled(fixture):
    _, store, audio, _, service, configure, register = fixture
    configure()
    register('v', 'one')
    service.plan('w', 'v', 'bar', ['one'])
    service.prepare('w', 'v', 'bar')
    audio.silent_outputs.add('dac-1')
    assert service.start('w', 'v', 'bar') is False
    assert store.pending_events('w', 'v') == []
    assert store.session('w', 'v', 'bar')['state'] == 'unknown'
    with pytest.raises(VenueError, match='unknown'):
        service.start('w', 'v', 'bar')


def test_restart_persistence_and_source_integrity(fixture):
    clock, store, audio, authority, service, configure, register = fixture
    configure()
    file = register('v', 'one')
    service.plan('w', 'v', 'bar', ['one'])
    service.prepare('w', 'v', 'bar')
    assert service.start('w', 'v', 'bar')
    store.close()
    reopened = VenueStore(store.path)
    rebuilt = VenueEngine(reopened, audio, authority, service.limits, clock=lambda: clock[0])
    assert rebuilt.store.session('w', 'v', 'bar')['current'] == 'one'
    file.write_bytes(b'TAMPERED')
    assert rebuilt.prepare('w', 'v', 'bar') == ()
    assert rebuilt.tick('w', 'v', 'bar').state == 'stopped'
    reopened.close()


def test_approved_local_fallback_and_preparation_cache(fixture):
    clock, store, audio, _, service, configure, register = fixture
    configure(policy=Policy(rights_attested=True, fallback_ids=('safe',), repeat_after_seconds=0))
    register('v', 'planned')
    register('v', 'safe')
    service.plan('w', 'v', 'bar', ['planned'])
    assert service.prepare('w', 'v', 'bar') == ('planned', 'safe')
    preps = len(audio.prepared)
    service.prepare('w', 'v', 'bar')
    assert len(audio.prepared) == preps  # don't continually rerender audio on every tick
    assert service.start('w', 'v', 'bar')
    gen = store.session('w', 'v', 'bar')['generation']
    clock[0] += 5
    audio.playing.pop('bar')
    assert service.ended('w', 'v', 'bar', generation=gen)
    assert audio.playing['bar'][0] == 'safe'
    assert service.diagnose('w', 'v', 'bar').state == 'playing'
    assert store.pending_events('w', 'v')[-1]['source'] == 'fallback'


def test_runner_boot_and_staff_stop_does_not_autorestart(fixture):
    clock, store, audio, _, service, configure, register = fixture
    from selecta.lf_venue import VenueRunner
    configure()
    register('v', 'first')
    service.plan('w', 'v', 'bar', ['first'])
    runner = VenueRunner(service, 'w', 'v', 'bar')
    assert runner.step().state == 'playing'
    assert service.stop('w', 'v', 'bar', reason='staff')
    for _ in range(5):
        clock[0] += 60
        assert runner.step().state == 'stopped'
    assert len([x for x in store.pending_events('w', 'v') if x['kind'] == 'started']) == 1


def test_dayparts_and_repeat_limiter(fixture):
    clock, store, audio, _, service, configure, register = fixture
    local_time = datetime.fromtimestamp(clock[0], UTC)
    assert local_time.hour == 21
    configure(policy=Policy(rights_attested=True, allow_explicit=True, repeat_after_seconds=500,
                            dayparts=(Daypart('20:00', '23:00', allow_explicit=False),)))
    register('v', 'clean', explicit=False)
    register('v', 'explicit', explicit=True)
    service.plan('w', 'v', 'bar', ['clean', 'explicit'])
    assert service.prepare('w', 'v', 'bar') == ('clean',)
    assert service.start('w', 'v', 'bar')
    gen = store.session('w', 'v', 'bar')['generation']
    audio.playing.pop('bar')
    assert not service.ended('w', 'v', 'bar', generation=gen)  # explicit must stay blocked
    assert service._eligible(store.config('w', 'v'), store.config('w', 'v').zones[0], 'clean', clock[0]) is None
